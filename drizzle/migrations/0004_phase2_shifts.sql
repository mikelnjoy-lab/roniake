CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  cashier_id uuid NOT NULL,
  opening_float numeric NOT NULL CHECK (opening_float >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  counted_cash numeric,
  expected_cash numeric,
  variance numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE UNIQUE INDEX shifts_one_open ON public.shifts(branch_id, cashier_id) WHERE status = 'open';
GRANT SELECT ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
-- Blind close: cashiers can see their own shift rows only through a view-safe RPC; table SELECT limited to roles that may see expected totals.
CREATE POLICY "shifts visible to reviewers" ON public.shifts FOR SELECT TO authenticated
  USING (can_access_branch_row(business_id, branch_id) AND has_permission(business_id, 'shift.view_expected'));

CREATE OR REPLACE FUNCTION public.my_open_shift(_branch uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', id, 'opened_at', opened_at, 'opening_float', opening_float)
  FROM public.shifts WHERE branch_id = _branch AND cashier_id = auth.uid() AND status = 'open' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.open_shift(_branch uuid, _float numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _biz uuid; _id uuid;
BEGIN
  _biz := public.branch_business_checked(_branch, 'pos.sell');
  IF _float IS NULL OR _float < 0 THEN RAISE EXCEPTION 'opening float must be zero or more'; END IF;
  INSERT INTO public.shifts(business_id, branch_id, cashier_id, opening_float)
  VALUES (_biz, _branch, auth.uid(), round(_float,2)) RETURNING id INTO _id;
  PERFORM public.write_audit(_biz, _branch, 'shift.open', 'shift', _id::text, jsonb_build_object('float', _float), null);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.close_shift(_shift uuid, _counted numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.shifts; _cash numeric; _exp numeric;
BEGIN
  SELECT * INTO _s FROM public.shifts WHERE id = _shift FOR UPDATE;
  IF NOT FOUND OR _s.cashier_id <> auth.uid() THEN RAISE EXCEPTION 'shift not found' USING errcode = '42501'; END IF;
  IF _s.status <> 'open' THEN RAISE EXCEPTION 'shift already closed'; END IF;
  IF _counted IS NULL OR _counted < 0 THEN RAISE EXCEPTION 'counted cash must be zero or more'; END IF;
  SELECT coalesce(sum(t.amount),0) - coalesce((SELECT sum(s2.change_given) FROM public.sales s2
      WHERE s2.branch_id=_s.branch_id AND s2.cashier_id=_s.cashier_id AND s2.created_at >= _s.opened_at),0)
    INTO _cash
    FROM public.sale_tenders t JOIN public.sales s ON s.id = t.sale_id
    WHERE s.branch_id=_s.branch_id AND s.cashier_id=_s.cashier_id AND s.created_at >= _s.opened_at AND t.tender_type='cash';
  _exp := _s.opening_float + _cash;
  UPDATE public.shifts SET status='closed', closed_at=now(), counted_cash=round(_counted,2), expected_cash=_exp, variance=round(_counted,2)-_exp WHERE id=_shift;
  PERFORM public.write_audit(_s.business_id, _s.branch_id, 'shift.close', 'shift', _shift::text, jsonb_build_object('counted', _counted), null);
  IF public.has_permission(_s.business_id, 'shift.view_expected') THEN
    RETURN jsonb_build_object('status','closed','counted',_counted,'expected',_exp,'variance',round(_counted,2)-_exp);
  END IF;
  RETURN jsonb_build_object('status','closed','counted',_counted);
END $$;

REVOKE ALL ON FUNCTION public.my_open_shift(uuid), public.open_shift(uuid,numeric), public.close_shift(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_open_shift(uuid), public.open_shift(uuid,numeric), public.close_shift(uuid,numeric) TO authenticated;