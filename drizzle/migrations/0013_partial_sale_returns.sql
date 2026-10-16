ALTER TABLE public.customer_ledger DROP CONSTRAINT customer_ledger_entry_type_check;
ALTER TABLE public.customer_ledger ADD CONSTRAINT customer_ledger_entry_type_check
  CHECK (entry_type = ANY (ARRAY['credit_sale','repayment','void_reversal','return_credit']));

CREATE TABLE public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  return_no text NOT NULL,
  refund_type public.tender_type NOT NULL,
  refund_amount numeric(14,2) NOT NULL CHECK (refund_amount >= 0),
  tax_amount numeric(14,2) NOT NULL,
  cogs_reversed numeric(14,2) NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  reference text,
  shift_id uuid REFERENCES public.shifts(id),
  client_ref uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sale_returns_client_ref ON public.sale_returns (business_id, client_ref);
CREATE INDEX sale_returns_sale ON public.sale_returns (sale_id);
GRANT SELECT ON public.sale_returns TO authenticated;
GRANT ALL ON public.sale_returns TO service_role;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_returns_select ON public.sale_returns FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id)
         AND (public.has_permission(business_id, 'reports.view') OR actor_user_id = auth.uid()));
CREATE TRIGGER sale_returns_immutable BEFORE UPDATE OR DELETE ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE TABLE public.sale_return_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES public.sale_returns(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  sale_line_id bigint NOT NULL REFERENCES public.sale_lines(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  refund_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  unit_cost numeric(14,4) NOT NULL,
  cogs_reversed numeric(14,2) NOT NULL
);
CREATE INDEX sale_return_lines_line ON public.sale_return_lines (sale_line_id);
GRANT SELECT ON public.sale_return_lines TO authenticated;
GRANT ALL ON public.sale_return_lines TO service_role;
ALTER TABLE public.sale_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_return_lines_select ON public.sale_return_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sale_returns r WHERE r.id = return_id));
CREATE TRIGGER sale_return_lines_immutable BEFORE UPDATE OR DELETE ON public.sale_return_lines FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE OR REPLACE FUNCTION public.return_sale_items(_sale uuid, _lines jsonb, _refund_type public.tender_type, _reason text, _reference text, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.sales; _biz uuid; _ex public.sale_returns; _rid uuid := gen_random_uuid(); _l record; _sl public.sale_lines; _p public.products;
  _done numeric; _amt numeric; _tax numeric; _cogs numeric; _tot numeric := 0; _ttax numeric := 0; _tcogs numeric := 0; _dup int; _shift uuid;
  _c public.customers; _no text; _paid_type numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '28000'; END IF;
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _s FROM public.sales WHERE id = _sale FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  _biz := public.branch_business_checked(_s.branch_id, 'sales.void');
  SELECT * INTO _ex FROM public.sale_returns WHERE business_id = _biz AND client_ref = _client_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('status','replay','return_id',_ex.id,'return_no',_ex.return_no,'refund_amount',_ex.refund_amount);
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_voids v WHERE v.sale_id = _sale) THEN RAISE EXCEPTION 'sale was voided — nothing to return'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF _refund_type NOT IN ('cash','mpesa_manual','deni') THEN RAISE EXCEPTION 'refund by cash, M-Pesa or Deni credit only'; END IF;
  IF _refund_type = 'mpesa_manual' AND (_reference IS NULL OR upper(trim(_reference)) !~ '^[A-Z0-9]{8,12}$') THEN RAISE EXCEPTION 'M-Pesa refunds need the reversal transaction code'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'choose at least one item to return'; END IF;
  SELECT count(*) - count(DISTINCT x.sale_line_id) INTO _dup FROM jsonb_to_recordset(_lines) AS x(sale_line_id bigint, qty numeric);
  IF _dup > 0 THEN RAISE EXCEPTION 'each item can appear only once'; END IF;
  SELECT coalesce(sum(t.amount),0) INTO _paid_type FROM public.sale_tenders t WHERE t.sale_id = _sale AND t.tender_type = _refund_type;
  IF _refund_type = 'deni' AND _paid_type = 0 THEN RAISE EXCEPTION 'Deni refund only for sales paid with Deni'; END IF;
  IF _refund_type = 'cash' THEN
    SELECT id INTO _shift FROM public.shifts WHERE branch_id = _s.branch_id AND cashier_id = auth.uid() AND status = 'open';
    IF _shift IS NULL THEN RAISE EXCEPTION 'open a shift before giving a cash refund'; END IF;
  END IF;
  SELECT _s.branch_id || '' INTO _no;
  _no := _s.receipt_no || '-R' || (SELECT count(*) + 1 FROM public.sale_returns WHERE sale_id = _sale);
  INSERT INTO public.sale_returns(id, business_id, branch_id, sale_id, return_no, refund_type, refund_amount, tax_amount, cogs_reversed, reason, reference, shift_id, client_ref, actor_user_id)
    VALUES (_rid, _biz, _s.branch_id, _sale, _no, _refund_type, 0, 0, 0, trim(_reason), nullif(upper(trim(_reference)),''), _shift, _client_ref, auth.uid());
  FOR _l IN SELECT * FROM jsonb_to_recordset(_lines) AS x(sale_line_id bigint, qty numeric) LOOP
    SELECT * INTO _sl FROM public.sale_lines WHERE id = _l.sale_line_id AND sale_id = _sale;
    IF NOT FOUND THEN RAISE EXCEPTION 'item is not on this sale'; END IF;
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'return quantity must be positive'; END IF;
    SELECT coalesce(sum(qty),0) INTO _done FROM public.sale_return_lines WHERE sale_line_id = _sl.id;
    IF _done + _l.qty > _sl.qty THEN RAISE EXCEPTION 'cannot return more % than sold (sold %, already returned %)', _sl.product_name, _sl.qty, _done; END IF;
    _amt := round(_sl.line_total * _l.qty / _sl.qty, 2);
    _tax := round(_sl.tax_amount * _l.qty / _sl.qty, 2);
    _cogs := round(_sl.unit_cost * _l.qty, 2);
    INSERT INTO public.sale_return_lines(return_id, business_id, sale_line_id, product_id, qty, refund_amount, tax_amount, unit_cost, cogs_reversed)
      VALUES (_rid, _biz, _sl.id, _sl.product_id, _l.qty, _amt, _tax, _sl.unit_cost, _cogs);
    SELECT * INTO _p FROM public.products WHERE id = _sl.product_id;
    IF _p.track_stock THEN
      PERFORM public.apply_stock_movement(_biz, _s.branch_id, _sl.product_id, 'adjustment', _l.qty, _sl.unit_cost, 'sale_return', _rid::text, 'return ' || _no);
    END IF;
    _tot := _tot + _amt; _ttax := _ttax + _tax; _tcogs := _tcogs + _cogs;
  END LOOP;
  IF _refund_type IN ('mpesa_manual','deni') AND _tot > _paid_type - coalesce((SELECT sum(refund_amount) FROM public.sale_returns WHERE sale_id = _sale AND refund_type = _refund_type AND id <> _rid),0) THEN
    RAISE EXCEPTION 'refund exceeds what was paid by this method';
  END IF;
  IF _refund_type = 'deni' THEN
    SELECT * INTO _c FROM public.customers WHERE id = _s.customer_id FOR UPDATE;
    IF _tot > _c.balance THEN RAISE EXCEPTION 'refund exceeds the customer''s Deni balance'; END IF;
    UPDATE public.customers SET balance = balance - _tot WHERE id = _c.id;
    INSERT INTO public.customer_ledger(business_id, customer_id, entry_type, amount, balance_after, sale_id, tender_type, reference, actor_user_id)
      VALUES (_biz, _c.id, 'return_credit', _tot, _c.balance - _tot, _sale, 'deni', _no, auth.uid());
  END IF;
  -- Header totals are written by a trusted path: the immutability trigger is bypassed only for this insert-time fill.
  DELETE FROM public.sale_return_lines WHERE false;
  PERFORM set_config('ronia.return_fill', _rid::text, true);
  UPDATE public.sale_returns SET refund_amount = _tot, tax_amount = _ttax, cogs_reversed = _tcogs WHERE id = _rid;
  PERFORM set_config('ronia.return_fill', '', true);
  PERFORM public.write_audit(_biz, _s.branch_id, 'sale.return', 'sale_return', _rid::text,
    jsonb_build_object('sale_id', _sale, 'return_no', _no, 'refund_type', _refund_type, 'refund_amount', _tot, 'reason', trim(_reason)), null);
  RETURN jsonb_build_object('status','created','return_id',_rid,'return_no',_no,'refund_amount',_tot);
END $$;

-- Allow only the trusted header fill inside return_sale_items; everything else stays immutable.
CREATE OR REPLACE FUNCTION public.sale_returns_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('ronia.return_fill', true) = OLD.id::text
     AND OLD.refund_amount = 0 AND NEW.id = OLD.id AND NEW.sale_id = OLD.sale_id AND NEW.refund_type = OLD.refund_type
     AND NEW.client_ref = OLD.client_ref AND NEW.actor_user_id = OLD.actor_user_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'sale returns are immutable';
END $$;
DROP TRIGGER sale_returns_immutable ON public.sale_returns;
CREATE TRIGGER sale_returns_immutable BEFORE UPDATE OR DELETE ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION public.sale_returns_guard();

REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, public.tender_type, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid, jsonb, public.tender_type, text, text, uuid) TO authenticated;

-- Blind close: cash refunds paid from this shift's drawer reduce expected cash.
CREATE OR REPLACE FUNCTION public.close_shift(_shift uuid, _counted numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _s public.shifts; _cash numeric; _paid numeric; _refunds numeric; _exp numeric;
BEGIN
  SELECT * INTO _s FROM public.shifts WHERE id = _shift FOR UPDATE;
  IF NOT FOUND OR _s.cashier_id <> auth.uid() THEN RAISE EXCEPTION 'shift not found' USING errcode = '42501'; END IF;
  IF _s.status <> 'open' THEN RAISE EXCEPTION 'shift already closed'; END IF;
  IF _counted IS NULL OR _counted < 0 THEN RAISE EXCEPTION 'counted cash must be zero or more'; END IF;
  SELECT coalesce(sum(t.amount),0) - coalesce((SELECT sum(s2.change_given) FROM public.sales s2
      WHERE s2.branch_id=_s.branch_id AND s2.cashier_id=_s.cashier_id AND s2.created_at >= _s.opened_at
        AND NOT EXISTS (SELECT 1 FROM public.sale_voids v WHERE v.sale_id = s2.id)),0)
    INTO _cash
    FROM public.sale_tenders t JOIN public.sales s ON s.id = t.sale_id
    WHERE s.branch_id=_s.branch_id AND s.cashier_id=_s.cashier_id AND s.created_at >= _s.opened_at AND t.tender_type='cash'
      AND NOT EXISTS (SELECT 1 FROM public.sale_voids v WHERE v.sale_id = s.id);
  SELECT coalesce(sum(amount),0) INTO _paid FROM public.shift_payouts WHERE shift_id = _shift;
  SELECT coalesce(sum(refund_amount),0) INTO _refunds FROM public.sale_returns WHERE shift_id = _shift AND refund_type = 'cash';
  _exp := _s.opening_float + _cash - _paid - _refunds;
  UPDATE public.shifts SET status='closed', closed_at=now(), counted_cash=round(_counted,2), expected_cash=_exp, variance=round(_counted,2)-_exp WHERE id=_shift;
  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'shift.close', 'shift', _shift::text, jsonb_build_object('counted', _counted, 'payouts', _paid, 'refunds', _refunds), null);
  IF public.has_permission(_s.business_id, 'shift.view_expected') THEN
    RETURN jsonb_build_object('status','closed','counted',_counted,'expected',_exp,'variance',round(_counted,2)-_exp,'payouts',_paid,'refunds',_refunds);
  END IF;
  RETURN jsonb_build_object('status','closed','counted',_counted);
END $function$;