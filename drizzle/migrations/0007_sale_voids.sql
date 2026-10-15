CREATE TABLE public.sale_voids (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  reason text NOT NULL,
  voided_by uuid NOT NULL,
  voided_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sale_voids TO authenticated;
GRANT ALL ON public.sale_voids TO service_role;
ALTER TABLE public.sale_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read voids in accessible branches" ON public.sale_voids FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id));
CREATE TRIGGER sale_voids_immutable BEFORE UPDATE OR DELETE ON public.sale_voids FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

INSERT INTO public.role_permissions(role, permission)
SELECT r::public.business_role, 'sales.void' FROM unnest(array['owner','manager']) r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role = r::public.business_role AND p.permission = 'sales.void');

ALTER TABLE public.customer_ledger DROP CONSTRAINT customer_ledger_entry_type_check;
ALTER TABLE public.customer_ledger ADD CONSTRAINT customer_ledger_entry_type_check CHECK (entry_type = ANY (ARRAY['credit_sale','repayment','void_reversal']));

CREATE OR REPLACE FUNCTION public.void_sale(_sale uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.sales; _l record; _deni numeric; _c public.customers;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'a void reason is required'; END IF;
  SELECT * INTO _s FROM public.sales WHERE id = _sale FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found' USING errcode = '42501'; END IF;
  PERFORM public.branch_business_checked(_s.branch_id, 'sales.void');
  IF EXISTS (SELECT 1 FROM public.sale_voids WHERE sale_id = _sale) THEN RAISE EXCEPTION 'sale already voided'; END IF;

  INSERT INTO public.sale_voids(sale_id, business_id, branch_id, reason, voided_by)
    VALUES (_sale, _s.business_id, _s.branch_id, trim(_reason), auth.uid());

  FOR _l IN SELECT sl.product_id, sl.qty, sl.unit_cost FROM public.sale_lines sl JOIN public.products p ON p.id = sl.product_id
            WHERE sl.sale_id = _sale AND p.track_stock LOOP
    PERFORM public.apply_stock_movement(_s.business_id, _s.branch_id, _l.product_id, 'adjustment', _l.qty, _l.unit_cost, 'sale_void', _sale::text, trim(_reason));
  END LOOP;

  SELECT coalesce(sum(amount),0) INTO _deni FROM public.sale_tenders WHERE sale_id = _sale AND tender_type = 'deni';
  IF _deni > 0 AND _s.customer_id IS NOT NULL THEN
    SELECT * INTO _c FROM public.customers WHERE id = _s.customer_id FOR UPDATE;
    UPDATE public.customers SET balance = balance - _deni WHERE id = _c.id;
    INSERT INTO public.customer_ledger(business_id, customer_id, entry_type, amount, balance_after, sale_id, tender_type, reference, actor_user_id)
      VALUES (_s.business_id, _c.id, 'void_reversal', _deni, _c.balance - _deni, _sale, 'deni', _s.receipt_no, auth.uid());
  END IF;

  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'sale.void', 'sale', _sale::text,
    jsonb_build_object('receipt_no', _s.receipt_no, 'total', _s.total, 'reason', trim(_reason)), null);
  RETURN jsonb_build_object('sale_id', _sale, 'receipt_no', _s.receipt_no, 'status', 'voided');
END $$;
REVOKE ALL ON FUNCTION public.void_sale(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_shift(_shift uuid, _counted numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _s public.shifts; _cash numeric; _exp numeric;
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
  _exp := _s.opening_float + _cash;
  UPDATE public.shifts SET status='closed', closed_at=now(), counted_cash=round(_counted,2), expected_cash=_exp, variance=round(_counted,2)-_exp WHERE id=_shift;
  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'shift.close', 'shift', _shift::text, jsonb_build_object('counted', _counted), null);
  IF public.has_permission(_s.business_id, 'shift.view_expected') THEN
    RETURN jsonb_build_object('status','closed','counted',_counted,'expected',_exp,'variance',round(_counted,2)-_exp);
  END IF;
  RETURN jsonb_build_object('status','closed','counted',_counted);
END $function$;