CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  name text NOT NULL CHECK (length(trim(name)) >= 2),
  phone text,
  kra_pin text,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_business_name ON public.suppliers (business_id, lower(trim(name)));
GRANT SELECT ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated
  USING (public.has_permission(business_id, 'inventory.manage') OR public.has_permission(business_id, 'reports.view'));

CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  invoice_no text NOT NULL,
  invoice_date date NOT NULL,
  total_cost numeric(14,2) NOT NULL,
  line_count integer NOT NULL,
  client_ref uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_invoices_supplier_no ON public.purchase_invoices (business_id, supplier_id, upper(trim(invoice_no)));
CREATE UNIQUE INDEX purchase_invoices_client_ref ON public.purchase_invoices (business_id, client_ref);
GRANT SELECT ON public.purchase_invoices TO authenticated;
GRANT ALL ON public.purchase_invoices TO service_role;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_invoices_select ON public.purchase_invoices FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id)
         AND (public.has_permission(business_id, 'inventory.manage') OR public.has_permission(business_id, 'reports.view')));
CREATE TRIGGER purchase_invoices_immutable BEFORE UPDATE OR DELETE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE TABLE public.purchase_invoice_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  line_cost numeric(14,2) NOT NULL
);
GRANT SELECT ON public.purchase_invoice_lines TO authenticated;
GRANT ALL ON public.purchase_invoice_lines TO service_role;
ALTER TABLE public.purchase_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_invoice_lines_select ON public.purchase_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id));
CREATE TRIGGER purchase_invoice_lines_immutable BEFORE UPDATE OR DELETE ON public.purchase_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

CREATE OR REPLACE FUNCTION public.save_supplier(_business uuid, _id uuid, _name text, _phone text, _kra_pin text, _terms integer, _active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _sid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(_business, 'inventory.manage') THEN RAISE EXCEPTION 'permission denied' USING errcode = '42501'; END IF;
  IF _name IS NULL OR length(trim(_name)) < 2 THEN RAISE EXCEPTION 'supplier name required'; END IF;
  IF _kra_pin IS NOT NULL AND trim(_kra_pin) <> '' AND upper(trim(_kra_pin)) !~ '^[A-Z][0-9]{9}[A-Z]$' THEN RAISE EXCEPTION 'KRA PIN must look like A123456789B'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.suppliers(business_id, name, phone, kra_pin, payment_terms_days, is_active, created_by)
    VALUES (_business, trim(_name), nullif(trim(_phone),''), nullif(upper(trim(_kra_pin)),''), coalesce(_terms,0), coalesce(_active,true), auth.uid()) RETURNING id INTO _sid;
  ELSE
    UPDATE public.suppliers SET name = trim(_name), phone = nullif(trim(_phone),''), kra_pin = nullif(upper(trim(_kra_pin)),''),
      payment_terms_days = coalesce(_terms,0), is_active = coalesce(_active,true), updated_at = now()
    WHERE id = _id AND business_id = _business RETURNING id INTO _sid;
    IF _sid IS NULL THEN RAISE EXCEPTION 'supplier not found'; END IF;
  END IF;
  PERFORM public.write_audit(_business, null, CASE WHEN _id IS NULL THEN 'supplier.created' ELSE 'supplier.updated' END, 'supplier', _sid::text,
    jsonb_build_object('name', trim(_name), 'terms', _terms, 'active', _active), null);
  RETURN _sid;
END $$;

CREATE OR REPLACE FUNCTION public.receive_purchase_invoice(_branch uuid, _supplier uuid, _invoice_no text, _invoice_date date, _lines jsonb, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _biz uuid; _s public.suppliers; _inv uuid := gen_random_uuid(); _l record; _p public.products; _total numeric := 0; _n int := 0; _dup int; _ex public.purchase_invoices;
BEGIN
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _ex FROM public.purchase_invoices WHERE business_id = _biz AND client_ref = _client_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('status','replay','invoice_id',_ex.id,'total_cost',_ex.total_cost,'lines',_ex.line_count);
  END IF;
  SELECT * INTO _s FROM public.suppliers WHERE id = _supplier AND business_id = _biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found'; END IF;
  IF NOT _s.is_active THEN RAISE EXCEPTION 'supplier is inactive'; END IF;
  IF _invoice_no IS NULL OR length(trim(_invoice_no)) < 1 THEN RAISE EXCEPTION 'invoice number required'; END IF;
  IF _invoice_date IS NULL OR _invoice_date > current_date + 1 THEN RAISE EXCEPTION 'invoice date cannot be in the future'; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_invoices WHERE business_id = _biz AND supplier_id = _supplier AND upper(trim(invoice_no)) = upper(trim(_invoice_no))) THEN
    RAISE EXCEPTION 'invoice % from % was already received', trim(_invoice_no), _s.name;
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'add at least one item'; END IF;
  SELECT count(*) - count(DISTINCT x.product_id) INTO _dup FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric);
  IF _dup > 0 THEN RAISE EXCEPTION 'each product can appear only once on an invoice'; END IF;
  SELECT count(*), coalesce(sum(round(x.qty * x.unit_cost, 2)),0) INTO _n, _total FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric);
  INSERT INTO public.purchase_invoices(id, business_id, branch_id, supplier_id, invoice_no, invoice_date, total_cost, line_count, client_ref, actor_user_id)
    VALUES (_inv, _biz, _branch, _supplier, trim(_invoice_no), _invoice_date, _total, _n, _client_ref, auth.uid());
  FOR _l IN SELECT * FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric) LOOP
    _p := public.product_in_business(_l.product_id, _biz);
    IF NOT _p.track_stock THEN RAISE EXCEPTION '% does not track stock', _p.name; END IF;
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
    IF _l.unit_cost IS NULL OR _l.unit_cost < 0 THEN RAISE EXCEPTION 'unit cost must be zero or more'; END IF;
    INSERT INTO public.purchase_invoice_lines(invoice_id, business_id, product_id, qty, unit_cost, line_cost)
      VALUES (_inv, _biz, _p.id, _l.qty, _l.unit_cost, round(_l.qty * _l.unit_cost, 2));
    PERFORM public.apply_stock_movement(_biz, _branch, _p.id, 'receipt', _l.qty, _l.unit_cost, 'purchase_invoice', _inv::text, _s.name || ' #' || trim(_invoice_no));
  END LOOP;
  PERFORM public.write_audit(_biz, _branch, 'purchase.received', 'purchase_invoice', _inv::text,
    jsonb_build_object('supplier_id', _supplier, 'invoice_no', trim(_invoice_no), 'total_cost', _total, 'lines', _n), null);
  RETURN jsonb_build_object('status','created','invoice_id',_inv,'total_cost',_total,'lines',_n);
END $$;

REVOKE ALL ON FUNCTION public.save_supplier(uuid, uuid, text, text, text, integer, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.receive_purchase_invoice(uuid, uuid, text, date, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, uuid, text, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_invoice(uuid, uuid, text, date, jsonb, uuid) TO authenticated;