CREATE TABLE public.mpesa_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid REFERENCES public.branches(id),
  kind text NOT NULL CHECK (kind IN ('till','paybill')),
  store_number text,
  till_number text,
  shortcode text,
  account_format text,
  status text NOT NULL DEFAULT 'configured' CHECK (status IN ('configured','credentials_pending','live_ready')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mpesa_configs_scope ON public.mpesa_configs (business_id, coalesce(branch_id,'00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT ON public.mpesa_configs TO authenticated;
GRANT ALL ON public.mpesa_configs TO service_role;
ALTER TABLE public.mpesa_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_configs_select ON public.mpesa_configs FOR SELECT TO authenticated
  USING (public.has_permission(business_id,'mpesa.configure') OR public.has_permission(business_id,'reports.view'));

CREATE TABLE public.mpesa_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  sale_tender_id bigint NOT NULL REFERENCES public.sale_tenders(id),
  status text NOT NULL CHECK (status IN ('verified','flagged')),
  note text,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mpesa_recon_tender ON public.mpesa_reconciliations (sale_tender_id, created_at DESC);
GRANT SELECT ON public.mpesa_reconciliations TO authenticated;
GRANT ALL ON public.mpesa_reconciliations TO service_role;
ALTER TABLE public.mpesa_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_recon_select ON public.mpesa_reconciliations FOR SELECT TO authenticated
  USING (public.has_permission(business_id,'mpesa.configure') OR public.has_permission(business_id,'reports.view'));
CREATE TRIGGER mpesa_recon_immutable BEFORE UPDATE OR DELETE ON public.mpesa_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE OR REPLACE FUNCTION public.save_mpesa_config(_business uuid, _branch uuid, _kind text, _store text, _till text, _shortcode text, _account_format text, _status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.has_permission(_business,'mpesa.configure') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF _branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id=_branch AND business_id=_business) THEN RAISE EXCEPTION 'branch not in business'; END IF;
  IF _status = 'live_ready' THEN RAISE EXCEPTION 'Live Ready is set only after Safaricom Daraja credentials are verified'; END IF;
  IF _status NOT IN ('configured','credentials_pending') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF _kind = 'till' AND coalesce(trim(_till),'') !~ '^[0-9]{5,8}$' THEN RAISE EXCEPTION 'Till number must be 5-8 digits'; END IF;
  IF _kind = 'paybill' AND coalesce(trim(_shortcode),'') !~ '^[0-9]{5,7}$' THEN RAISE EXCEPTION 'PayBill shortcode must be 5-7 digits'; END IF;
  IF _kind NOT IN ('till','paybill') THEN RAISE EXCEPTION 'invalid kind'; END IF;
  SELECT id INTO _id FROM mpesa_configs WHERE business_id=_business AND branch_id IS NOT DISTINCT FROM _branch;
  IF _id IS NULL THEN
    INSERT INTO mpesa_configs(business_id,branch_id,kind,store_number,till_number,shortcode,account_format,status,updated_by)
    VALUES (_business,_branch,_kind,nullif(trim(_store),''),nullif(trim(_till),''),nullif(trim(_shortcode),''),nullif(trim(_account_format),''),_status,auth.uid()) RETURNING id INTO _id;
  ELSE
    UPDATE mpesa_configs SET kind=_kind,store_number=nullif(trim(_store),''),till_number=nullif(trim(_till),''),shortcode=nullif(trim(_shortcode),''),
      account_format=nullif(trim(_account_format),''),status=_status,updated_by=auth.uid(),updated_at=now() WHERE id=_id;
  END IF;
  PERFORM public.write_audit(_business,_branch,'mpesa.config_saved','mpesa_config',_id::text,
    jsonb_build_object('kind',_kind,'till',_till,'shortcode',_shortcode,'store',_store,'status',_status),NULL);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_mpesa(_tender bigint, _status text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t sale_tenders; _branch uuid;
BEGIN
  SELECT * INTO _t FROM sale_tenders WHERE id=_tender;
  IF _t.id IS NULL OR _t.tender_type <> 'mpesa_manual' THEN RAISE EXCEPTION 'M-Pesa payment not found'; END IF;
  IF NOT (public.has_permission(_t.business_id,'mpesa.configure') OR public.has_permission(_t.business_id,'reports.view')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  SELECT branch_id INTO _branch FROM sales WHERE id=_t.sale_id;
  IF NOT public.can_access_branch(_branch) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('verified','flagged') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF _status = 'flagged' AND length(coalesce(trim(_note),'')) < 3 THEN RAISE EXCEPTION 'Explain the mismatch'; END IF;
  INSERT INTO mpesa_reconciliations(business_id,sale_tender_id,status,note,actor_user_id) VALUES (_t.business_id,_tender,_status,nullif(trim(_note),''),auth.uid());
  PERFORM public.write_audit(_t.business_id,_branch,'mpesa.'||_status,'sale_tender',_tender::text,
    jsonb_build_object('reference',_t.reference,'amount',_t.amount,'note',_note),NULL);
END $$;

REVOKE ALL ON FUNCTION public.save_mpesa_config(uuid,uuid,text,text,text,text,text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reconcile_mpesa(bigint,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_mpesa_config(uuid,uuid,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_mpesa(bigint,text,text) TO authenticated;