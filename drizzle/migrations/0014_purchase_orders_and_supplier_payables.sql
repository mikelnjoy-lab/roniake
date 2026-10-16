insert into public.role_permissions(role, permission)
select r::public.business_role, p from unnest(array['owner','manager']) r, unnest(array['purchasing.approve','payables.pay']) p
where not exists (select 1 from public.role_permissions x where x.role = r::public.business_role and x.permission = p);

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  po_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partially_received','received','cancelled')),
  note text,
  expected_total numeric(14,2) NOT NULL,
  client_ref uuid NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid, approved_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_orders_no ON public.purchase_orders (business_id, po_no);
CREATE UNIQUE INDEX purchase_orders_client_ref ON public.purchase_orders (business_id, client_ref);
GRANT SELECT ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id)
         AND (public.has_permission(business_id, 'inventory.manage') OR public.has_permission(business_id, 'reports.view')));

CREATE TABLE public.purchase_order_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  qty_ordered numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  qty_received numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0 AND qty_received <= qty_ordered),
  UNIQUE (po_id, product_id)
);
GRANT SELECT ON public.purchase_order_lines TO authenticated;
GRANT ALL ON public.purchase_order_lines TO service_role;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_lines_select ON public.purchase_order_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders o WHERE o.id = po_id));

-- Only received quantity may change on a PO line, and only upward.
CREATE OR REPLACE FUNCTION public.po_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'purchase order lines cannot be deleted'; END IF;
  IF NEW.po_id <> OLD.po_id OR NEW.product_id <> OLD.product_id OR NEW.qty_ordered <> OLD.qty_ordered
     OR NEW.unit_cost <> OLD.unit_cost OR NEW.business_id <> OLD.business_id OR NEW.qty_received < OLD.qty_received THEN
    RAISE EXCEPTION 'purchase order lines are fixed once created';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_lines_guard BEFORE UPDATE OR DELETE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.po_line_guard();

CREATE OR REPLACE FUNCTION public.po_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'purchase orders cannot be deleted'; END IF;
  IF NEW.business_id <> OLD.business_id OR NEW.branch_id <> OLD.branch_id OR NEW.supplier_id <> OLD.supplier_id
     OR NEW.po_no <> OLD.po_no OR NEW.expected_total <> OLD.expected_total OR NEW.client_ref <> OLD.client_ref THEN
    RAISE EXCEPTION 'purchase order details are fixed once created';
  END IF;
  IF OLD.status IN ('received','cancelled') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'purchase order is closed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_orders_guard BEFORE UPDATE OR DELETE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.po_guard();

ALTER TABLE public.purchase_invoices ADD COLUMN purchase_order_id uuid REFERENCES public.purchase_orders(id);

CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','mpesa','bank','cheque','other')),
  reference text,
  paid_on date NOT NULL,
  client_ref uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_payments_client_ref ON public.supplier_payments (business_id, client_ref);
CREATE UNIQUE INDEX supplier_payments_reference ON public.supplier_payments (business_id, method, upper(trim(reference))) WHERE reference IS NOT NULL;
GRANT SELECT ON public.supplier_payments TO authenticated;
GRANT ALL ON public.supplier_payments TO service_role;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT TO authenticated
  USING (public.can_access_branch_row(business_id, branch_id)
         AND (public.has_permission(business_id, 'inventory.manage') OR public.has_permission(business_id, 'reports.view')));
CREATE TRIGGER supplier_payments_immutable BEFORE UPDATE OR DELETE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

-- Core invoice posting shared by direct receiving and PO receiving (not callable by clients).
CREATE OR REPLACE FUNCTION public.post_purchase_invoice_internal(_biz uuid, _branch uuid, _supplier uuid, _invoice_no text, _invoice_date date, _lines jsonb, _client_ref uuid, _po uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.suppliers; _inv uuid := gen_random_uuid(); _l record; _p public.products; _total numeric := 0; _n int := 0; _dup int;
BEGIN
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
  INSERT INTO public.purchase_invoices(id, business_id, branch_id, supplier_id, invoice_no, invoice_date, total_cost, line_count, client_ref, actor_user_id, purchase_order_id)
    VALUES (_inv, _biz, _branch, _supplier, trim(_invoice_no), _invoice_date, _total, _n, _client_ref, auth.uid(), _po);
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
    jsonb_build_object('supplier_id', _supplier, 'invoice_no', trim(_invoice_no), 'total_cost', _total, 'lines', _n, 'purchase_order_id', _po), null);
  RETURN jsonb_build_object('status','created','invoice_id',_inv,'total_cost',_total,'lines',_n);
END $$;
REVOKE ALL ON FUNCTION public.post_purchase_invoice_internal(uuid, uuid, uuid, text, date, jsonb, uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.receive_purchase_invoice(_branch uuid, _supplier uuid, _invoice_no text, _invoice_date date, _lines jsonb, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _biz uuid; _ex public.purchase_invoices;
BEGIN
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _ex FROM public.purchase_invoices WHERE business_id = _biz AND client_ref = _client_ref;
  IF FOUND THEN RETURN jsonb_build_object('status','replay','invoice_id',_ex.id,'total_cost',_ex.total_cost,'lines',_ex.line_count); END IF;
  RETURN public.post_purchase_invoice_internal(_biz, _branch, _supplier, _invoice_no, _invoice_date, _lines, _client_ref, null);
END $$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(_branch uuid, _supplier uuid, _lines jsonb, _note text, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _biz uuid; _s public.suppliers; _ex public.purchase_orders; _id uuid := gen_random_uuid(); _no text; _l record; _p public.products; _total numeric; _dup int;
BEGIN
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _ex FROM public.purchase_orders WHERE business_id = _biz AND client_ref = _client_ref;
  IF FOUND THEN RETURN jsonb_build_object('status','replay','po_id',_ex.id,'po_no',_ex.po_no); END IF;
  SELECT * INTO _s FROM public.suppliers WHERE id = _supplier AND business_id = _biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found'; END IF;
  IF NOT _s.is_active THEN RAISE EXCEPTION 'supplier is inactive'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'add at least one item'; END IF;
  SELECT count(*) - count(DISTINCT x.product_id), coalesce(sum(round(x.qty * x.unit_cost, 2)),0) INTO _dup, _total
    FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric);
  IF _dup > 0 THEN RAISE EXCEPTION 'each product can appear only once on an order'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('po:' || _biz::text));
  SELECT 'PO-' || lpad((count(*) + 1)::text, 5, '0') INTO _no FROM public.purchase_orders WHERE business_id = _biz;
  INSERT INTO public.purchase_orders(id, business_id, branch_id, supplier_id, po_no, note, expected_total, client_ref, created_by)
    VALUES (_id, _biz, _branch, _supplier, _no, nullif(trim(_note),''), _total, _client_ref, auth.uid());
  FOR _l IN SELECT * FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric) LOOP
    _p := public.product_in_business(_l.product_id, _biz);
    IF NOT _p.track_stock THEN RAISE EXCEPTION '% does not track stock', _p.name; END IF;
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
    IF _l.unit_cost IS NULL OR _l.unit_cost < 0 THEN RAISE EXCEPTION 'unit cost must be zero or more'; END IF;
    INSERT INTO public.purchase_order_lines(po_id, business_id, product_id, qty_ordered, unit_cost) VALUES (_id, _biz, _p.id, _l.qty, _l.unit_cost);
  END LOOP;
  PERFORM public.write_audit(_biz, _branch, 'po.created', 'purchase_order', _id::text,
    jsonb_build_object('po_no', _no, 'supplier_id', _supplier, 'expected_total', _total), null);
  RETURN jsonb_build_object('status','created','po_id',_id,'po_no',_no,'expected_total',_total);
END $$;

CREATE OR REPLACE FUNCTION public.approve_purchase_order(_po uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o public.purchase_orders;
BEGIN
  SELECT * INTO _o FROM public.purchase_orders WHERE id = _po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  PERFORM public.branch_business_checked(_o.branch_id, 'purchasing.approve');
  IF _o.status = 'approved' THEN RETURN jsonb_build_object('status','replay'); END IF;
  IF _o.status <> 'draft' THEN RAISE EXCEPTION 'only draft orders can be approved (this one is %)', _o.status; END IF;
  UPDATE public.purchase_orders SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = _po;
  PERFORM public.write_audit(_o.business_id, _o.branch_id, 'po.approved', 'purchase_order', _po::text, jsonb_build_object('po_no', _o.po_no), null);
  RETURN jsonb_build_object('status','approved');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(_po uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o public.purchase_orders;
BEGIN
  SELECT * INTO _o FROM public.purchase_orders WHERE id = _po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  PERFORM public.branch_business_checked(_o.branch_id, 'purchasing.approve');
  IF _o.status = 'cancelled' THEN RETURN jsonb_build_object('status','replay'); END IF;
  IF _o.status = 'received' THEN RAISE EXCEPTION 'a fully received order cannot be cancelled'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'give a reason for cancelling'; END IF;
  UPDATE public.purchase_orders SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(_reason), updated_at = now() WHERE id = _po;
  PERFORM public.write_audit(_o.business_id, _o.branch_id, 'po.cancelled', 'purchase_order', _po::text,
    jsonb_build_object('po_no', _o.po_no, 'previous_status', _o.status, 'reason', trim(_reason)), null);
  RETURN jsonb_build_object('status','cancelled');
END $$;

-- Receive a (partial) delivery against an approved order. Over-receiving is refused.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(_po uuid, _invoice_no text, _invoice_date date, _lines jsonb, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o public.purchase_orders; _ex public.purchase_invoices; _l record; _pl public.purchase_order_lines; _r jsonb; _open int;
BEGIN
  SELECT * INTO _o FROM public.purchase_orders WHERE id = _po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  PERFORM public.branch_business_checked(_o.branch_id, 'inventory.manage');
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _ex FROM public.purchase_invoices WHERE business_id = _o.business_id AND client_ref = _client_ref;
  IF FOUND THEN RETURN jsonb_build_object('status','replay','invoice_id',_ex.id,'total_cost',_ex.total_cost,'lines',_ex.line_count); END IF;
  IF _o.status = 'cancelled' THEN RAISE EXCEPTION 'order % was cancelled — nothing more can be received', _o.po_no; END IF;
  IF _o.status = 'draft' THEN RAISE EXCEPTION 'order % must be approved before receiving', _o.po_no; END IF;
  IF _o.status = 'received' THEN RAISE EXCEPTION 'order % is already fully received', _o.po_no; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'add at least one item'; END IF;
  FOR _l IN SELECT * FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric) LOOP
    SELECT * INTO _pl FROM public.purchase_order_lines WHERE po_id = _po AND product_id = _l.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'an item on this delivery is not on order %', _o.po_no; END IF;
    IF _l.qty IS NOT NULL AND _l.qty > _pl.qty_ordered - _pl.qty_received THEN
      RAISE EXCEPTION 'over-receiving refused: only % left to receive for an item on %', _pl.qty_ordered - _pl.qty_received, _o.po_no;
    END IF;
  END LOOP;
  _r := public.post_purchase_invoice_internal(_o.business_id, _o.branch_id, _o.supplier_id, _invoice_no, _invoice_date, _lines, _client_ref, _po);
  FOR _l IN SELECT * FROM jsonb_to_recordset(_lines) AS x(product_id uuid, qty numeric, unit_cost numeric) LOOP
    UPDATE public.purchase_order_lines SET qty_received = qty_received + _l.qty WHERE po_id = _po AND product_id = _l.product_id;
  END LOOP;
  SELECT count(*) INTO _open FROM public.purchase_order_lines WHERE po_id = _po AND qty_received < qty_ordered;
  UPDATE public.purchase_orders SET status = CASE WHEN _open = 0 THEN 'received' ELSE 'partially_received' END, updated_at = now() WHERE id = _po;
  RETURN _r || jsonb_build_object('po_status', CASE WHEN _open = 0 THEN 'received' ELSE 'partially_received' END);
END $$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(_invoice uuid, _amount numeric, _method text, _reference text, _paid_on date, _client_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _i public.purchase_invoices; _ex public.supplier_payments; _paid numeric; _id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _i FROM public.purchase_invoices WHERE id = _invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  PERFORM public.branch_business_checked(_i.branch_id, 'payables.pay');
  IF _client_ref IS NULL THEN RAISE EXCEPTION 'client reference required'; END IF;
  SELECT * INTO _ex FROM public.supplier_payments WHERE business_id = _i.business_id AND client_ref = _client_ref;
  IF FOUND THEN RETURN jsonb_build_object('status','replay','payment_id',_ex.id,'amount',_ex.amount); END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount <> round(_amount, 2) THEN RAISE EXCEPTION 'payment amount must be positive (shillings and cents)'; END IF;
  IF _method IS NULL OR _method NOT IN ('cash','mpesa','bank','cheque','other') THEN RAISE EXCEPTION 'choose a payment method'; END IF;
  IF _method <> 'cash' AND (_reference IS NULL OR length(trim(_reference)) < 3) THEN RAISE EXCEPTION 'a reference (M-Pesa code, bank or cheque number) is required'; END IF;
  IF _paid_on IS NULL OR _paid_on > current_date + 1 THEN RAISE EXCEPTION 'payment date cannot be in the future'; END IF;
  IF _paid_on < _i.invoice_date THEN RAISE EXCEPTION 'payment date is before the invoice date'; END IF;
  IF nullif(trim(_reference),'') IS NOT NULL AND EXISTS (SELECT 1 FROM public.supplier_payments
       WHERE business_id = _i.business_id AND method = _method AND upper(trim(reference)) = upper(trim(_reference))) THEN
    RAISE EXCEPTION 'payment reference % was already recorded', upper(trim(_reference));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pay:' || _invoice::text));
  SELECT coalesce(sum(amount),0) INTO _paid FROM public.supplier_payments WHERE invoice_id = _invoice;
  IF _paid + _amount > _i.total_cost THEN
    RAISE EXCEPTION 'overpayment refused: only % is outstanding on invoice %', _i.total_cost - _paid, _i.invoice_no;
  END IF;
  INSERT INTO public.supplier_payments(id, business_id, branch_id, supplier_id, invoice_id, amount, method, reference, paid_on, client_ref, actor_user_id)
    VALUES (_id, _i.business_id, _i.branch_id, _i.supplier_id, _invoice, _amount, _method, nullif(upper(trim(_reference)),''), _paid_on, _client_ref, auth.uid());
  PERFORM public.write_audit(_i.business_id, _i.branch_id, 'supplier.payment', 'supplier_payment', _id::text,
    jsonb_build_object('invoice_id', _invoice, 'invoice_no', _i.invoice_no, 'amount', _amount, 'method', _method, 'reference', nullif(upper(trim(_reference)),''), 'outstanding_after', _i.total_cost - _paid - _amount), null);
  RETURN jsonb_build_object('status','created','payment_id',_id,'amount',_amount,'outstanding',_i.total_cost - _paid - _amount);
END $$;

-- Balances are always derived from invoices and payments; nothing is stored or editable.
CREATE OR REPLACE FUNCTION public.supplier_balances(_business uuid)
RETURNS TABLE(supplier_id uuid, supplier_name text, invoiced numeric, paid numeric, outstanding numeric, overdue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH inv AS (
    SELECT i.id, i.supplier_id, i.total_cost, i.invoice_date,
           coalesce((SELECT sum(p.amount) FROM public.supplier_payments p WHERE p.invoice_id = i.id),0) AS paid
    FROM public.purchase_invoices i WHERE i.business_id = _business
  )
  SELECT s.id, s.name, coalesce(sum(inv.total_cost),0), coalesce(sum(inv.paid),0), coalesce(sum(inv.total_cost - inv.paid),0),
         coalesce(sum(inv.total_cost - inv.paid) FILTER (WHERE inv.invoice_date + s.payment_terms_days < current_date),0)
  FROM public.suppliers s LEFT JOIN inv ON inv.supplier_id = s.id
  WHERE s.business_id = _business
  GROUP BY s.id, s.name
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(uuid, uuid, jsonb, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.approve_purchase_order(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, text, date, jsonb, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.supplier_balances(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, uuid, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_purchase_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, text, date, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_balances(uuid) TO authenticated;