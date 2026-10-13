# WORLD TV — Pocketi Ghana manual payment operations

**STATUS: Proposed operating procedure. Not evidence of successful payments, provider integration, or launch approval.**
**Temporary confirmation inbox:** worldtvlive231@gmail.com

## Customer checkout

1. The **Pay from Ghana** buttons on `/subscribe.html` open the existing hosted Pocketi product URL:
   `https://pocketi.shop/worldtv/p/worldtv-yearly-subscription`.
2. The customer completes checkout in Pocketi and keeps their transaction reference.
3. The customer emails **worldtvlive231@gmail.com** with their Pocketi transaction reference, amount in GHS, payment date, and the email used for their registered WORLD TV account. They must not email card details, PINs, passwords, one-time passwords or similar sensitive data.
4. The customer should be told that *sending a receipt is not activation*; activation requires successful merchant-side verification and manual processing.

## Independent verification — must happen before code issuance

1. Locate the payment in **Pocketi merchant Sales / transactions**, independent of the customer's email or screenshot. Match the exact merchant transaction reference, successful/settled status, amount, currency, product, payment date and merchant/store. Do not accept a pending, cancelled, reversed, refunded or uncertain payment as a confirmed purchase.
2. Confirm the customer's registered WORLD TV email using the authorized Railway admin account. Make sure the payment can reliably be attributed to that person; resolve mismatches with the customer before activation.
3. **Duplicate-fulfillment blocker:** The current Railway manual activation endpoint does not save the Pocketi merchant reference in the resulting paid order. Before using it with real hosted-link customers, maintain a *private, access-controlled, unique-reference confirmation ledger*, recording the full merchant reference once (unique), account email, confirmed amount/currency, review time, admin reviewer, and the resulting WORLD TV order ID. Double-check both the ledger and existing subscription/order history before issuing any code. Do not put personal information or payment details in GitHub.
4. Use authorized admin **Customer management / Activate** only when the exact payment and customer have been verified and the duplicate check passes. If a matching `checkout_request` already exists, use **Subscription Requests → Confirm Payment → Issue Code** after merchant verification instead of separately activating the same payment. **Never issue through both paths for one transaction.** Check that an unused one-year code is available. Do not share an activation code until the action succeeds.
5. Confirm that the correct customer received exactly one code and that expiry is correct; update the private ledger with the resulting order ID/status. If an activation email fails, follow up manually without issuing a second code.
6. Escalate unmatched references, price discrepancies, cancelled/refunded payments, no available codes, and disputed payments. Never fulfill based solely on a customer's claim.

## Current technical limitations / launch holds

- The separate hosted Pocketi product link does **not** automatically link provider payments to WORLD TV accounts. Its use is manual for now.
- The Railway `/api/admin/customers/:id/activate` endpoint can create a paid order and assign an unused code, but it does not enforce uniqueness on **Pocketi merchant references**. A robust first-class integration/ledger is needed to make duplicate protection automatic.
- Existing manual activation may store the plan's configured GHS price rather than the exact external merchant charge. Reconcile sales reporting to merchant settlement records; do not assume admin dashboard revenue exactly matches Pocketi.
- The Gmail account is connected and has received ordinary incoming messages, but a customer payment email, staff response time, operator training, actual Pocketi merchant verification, and a production subscription activation have **not** been tested end to end.
- GitHub draft PR #167 must **not be merged to main or deployed to Railway without explicit go-live confirmation**. Cloudflare migration staging and live Railway remain separate. Do not change production DNS or live payment settings in this PR.

## Verification checklist (before requesting launch approval)

- [ ] Confirm customers can reach the **existing** Pocketi merchant checkout (without performing an unintended real purchase).
- [ ] Confirm the Gmail message template opens and a non-sensitive test message actually arrives.
- [ ] Confirm the merchant admin can retrieve a **real verified paid transaction** with exact reference, amount and customer match, using merchant credentials only in its official dashboard.
- [ ] Confirm admin role access, code inventory, renewal-vs-new account flow, expiry and single issuance with an authorized controlled test; do not use actual customer data for testing.
- [ ] Demonstrate duplicate-refusal workflow, pending payment refusal, refund and disputed-payment handling.
- [ ] Capture a secure prior live Railway backup and a rollback plan.
- [ ] Obtain explicit owner sign-off before the first deployment to production.
