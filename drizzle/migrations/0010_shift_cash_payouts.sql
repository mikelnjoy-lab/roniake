CREATE TABLE public.shift_payouts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  category text NOT NULL CHECK (category IN ('supplies','transport','cleaning','staff_meal','supplier_payment','other')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shift_payouts TO authenticated;
GRANT ALL ON public.shift_payouts TO service_role;
ALTER TABLE public.shift_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts visible to own cashier or reviewers" ON public.shift_payouts FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id)
         AND (actor_user_id = auth.uid() OR public.has_permission(business_id, 'shift.view_expected')));
CREATE TRIGGER shift_payouts_immutable BEFORE UPDATE OR DELETE ON public.shift_payouts
  FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE OR REPLACE FUNCTION public.record_shift_payout(_shift uuid, _amount numeric, _category text, _reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.shifts; _id bigint;
BEGIN
  SELECT * INTO _s FROM public.shifts WHERE id = _shift FOR UPDATE;
  IF NOT FOUND OR _s.cashier_id <> auth.uid() THEN RAISE EXCEPTION 'shift not found' USING errcode = '42501'; END IF;
  IF _s.status <> 'open' THEN RAISE EXCEPTION 'shift is closed'; END IF;
  IF NOT public.can_access_branch_row(_s.business_id, _s.branch_id) THEN RAISE EXCEPTION 'no branch access' USING errcode = '42501'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be more than zero'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason required'; END IF;
  INSERT INTO public.shift_payouts(shift_id, business_id, branch_id, amount, category, reason, actor_user_id)
  VALUES (_shift, _s.business_id, _s.branch_id, round(_amount,2), _category, trim(_reason), auth.uid()) RETURNING id INTO _id;
  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'shift.payout', 'shift_payout', _id::text,
    jsonb_build_object('shift_id', _shift, 'amount', round(_amount,2), 'category', _category, 'reason', trim(_reason)), null);
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.record_shift_payout(uuid, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_shift_payout(uuid, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_shift(_shift uuid, _counted numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _s public.shifts; _cash numeric; _paid numeric; _exp numeric;
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
  _exp := _s.opening_float + _cash - _paid;
  UPDATE public.shifts SET status='closed', closed_at=now(), counted_cash=round(_counted,2), expected_cash=_exp, variance=round(_counted,2)-_exp WHERE id=_shift;
  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'shift.close', 'shift', _shift::text, jsonb_build_object('counted', _counted, 'payouts', _paid), null);
  IF public.has_permission(_s.business_id, 'shift.view_expected') THEN
    RETURN jsonb_build_object('status','closed','counted',_counted,'expected',_exp,'variance',round(_counted,2)-_exp,'payouts',_paid);
  END IF;
  RETURN jsonb_build_object('status','closed','counted',_counted);
END $function$;