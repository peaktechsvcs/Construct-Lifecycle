# Receiving and delivery tracking

The Receiving page is the operational handoff between supplier delivery updates and
the quantities the team accepts at the jobsite. Delivery tracking and receiving
disposition are related, but they are recorded separately so a shipment can be
updated without changing the quantity decision.

## Open the receiving queue

1. Open **Receiving** from the Operations section.
2. Use **Search receiving queue** to find a purchase order by PO number or customer.
3. Use **Queue view** to narrow the work:
   - **All work** shows every order with receiving activity.
   - **Needs receiving** shows partially fulfilled orders.
   - **Exceptions** shows orders with receiving work that may need review.
   - **Complete** shows fulfilled or closed orders.
4. Select an order to open its delivery and receiving details.

The queue is scoped to the active customer environment. An order from another
tenant or environment cannot be opened by changing the order URL.

## Track a delivery

Each delivery has a **Delivery tracking** panel. Update the panel when the
supplier, carrier, or jobsite team provides new shipment information.

| Field | Use |
| --- | --- |
| **Delivery status** | Record the current shipment state. |
| **Appointment date** | Record or correct the planned delivery date. Clear it when no appointment is scheduled. |
| **Carrier** | Enter the freight carrier, supplier, or delivery service. |
| **Tracking reference** | Enter a PRO number, carrier tracking number, supplier confirmation number, or similar reference. |
| **Received by** | Record the person who accepted the shipment at the jobsite. |
| **Tracking notes** | Record delays, appointment changes, delivery instructions, or handoff context. |

Choose **Save tracking** to persist the update. The delivery number and current
status remain visible on the delivery card after the save.

### Delivery statuses

- **Scheduled** — delivery is planned but has not been confirmed.
- **Confirmed** — the supplier or carrier has confirmed the appointment.
- **In transit** — the shipment is moving to the jobsite.
- **Delivered** — the shipment arrived and can be reconciled.
- **Partial** — only part of the shipment arrived or was delivered.
- **Exception** — a delay, damage, shortage, or other issue needs attention.
- **Returned** — the shipment or material was returned to the supplier.
- **Canceled** — the planned delivery will not occur.

Status describes shipment progress. It does not, by itself, accept quantities
into the project or close the purchase order.

## Record receiving disposition

Use the receiving fields below the tracking panel for each delivered line:

- **Accepted** — quantity accepted for the project.
- **Damaged** — quantity that arrived damaged.
- **Short** — quantity expected but not received.
- **Returned** — quantity sent back to the supplier.
- **Exception note** — explanation for damage, shortage, or return.

The four quantities cannot exceed the quantity delivered. Use **Fill remaining
accepted** when all remaining units should be accepted after accounting for
exceptions. Select **Accept this line for receiving** before saving the
disposition.

Choose **Save receiving** to recalculate the order's received totals. The order
can remain partially fulfilled until all expected quantities have been delivered
and reconciled.

## Add proof of delivery

Use **Add proof** on the delivery card to attach a delivery receipt, signed
packing slip, or other proof:

- Supported files: PDF, JPG, PNG, and GIF.
- Maximum file size: 25 MB.
- Files are stored in protected object storage.
- The file is screened before it becomes available as delivery evidence.

After screening, choose **View proof** to open the protected file. A proof file
supports the review record; it does not automatically accept receiving quantities.

## Recommended workflow

1. Create or confirm the delivery against the purchase order.
2. Update the delivery status, appointment, carrier, and tracking reference as
   information changes.
3. Add proof of delivery when the shipment arrives.
4. Enter accepted, damaged, short, and returned quantities for each delivery line.
5. Add an exception note for any quantity that is not accepted.
6. Save receiving after the jobsite team reviews the shipment.
7. Review the order status and audit history before payment or closeout.

All delivery updates and receiving dispositions remain attached to the purchase
order's audit history. Tracking updates do not bypass quantity validation or
payment and closeout controls.

## API contract

The receiving page uses the tenant-scoped delivery update endpoint:

```http
PATCH /api/supplier-deliveries/{deliveryId}
```

The update body may include any of the following fields:

```json
{
  "status": "in_transit",
  "appointmentDate": "2026-09-24",
  "carrier": "Example Freight",
  "trackingReference": "PRO-123456",
  "recipientName": "Site superintendent",
  "notes": "Driver confirmed a morning appointment."
}
```

Blank optional values are sent as `null` so a user can intentionally clear
outdated tracking information. Delivery records, order records, and audit events
are all limited to the active tenant and environment.