WORLD TV — PRODUCT MANAGER BUILD

This version continues the website while keeping online payment for later.

NEW FEATURES
- Admin Products tab
- Add products
- Upload product photos
- Set price in GH₵
- Add description
- Add category
- Set stock status: In stock / Pre-order / Out of stock
- Set WhatsApp order number
- Mark products as Featured
- Edit products
- Delete products
- Public products page populated automatically from the database
- Featured products appear automatically on the homepage
- WhatsApp order button creates a product-specific message
- Existing customer accounts, subscription-code structure, and admin code upload remain included

DEFAULT WHATSAPP
+233 24 490 9092

PAYMENT
Paystack remains deferred in this version.

RUN LOCALLY
1. Install Node.js 18+
2. npm install
3. Copy .env.example to .env
4. Set ADMIN_EMAIL and ADMIN_PASSWORD
5. npm start
6. Open http://localhost:3000
7. Admin: http://localhost:3000/admin.html

PRODUCT IMAGES
Uploads are stored in public/uploads/.
Maximum image size: 4 MB.
Supported: JPG, PNG, WEBP, GIF.

PRODUCTION NOTES
Before public launch, use persistent secure sessions, HTTPS, rate limiting,
backup storage for uploaded product images, database backups, and proper
hosting secret management.


NEXT-STAGE ADDITIONS
- About World TV page
- FAQ page
- Dedicated World TV App Download page
- Draft Terms of Service page
- Draft Privacy Policy page
- Homepage navigation/footer updated to expose these pages
- Payment remains deferred

The Terms and Privacy text is a development placeholder and should be legally reviewed before public launch.


CUSTOMER MANAGEMENT ADDED
- Search registered customers
- View each customer's subscription/order history
- View assigned subscription codes and expiry dates
- Manually activate a customer for the 1-year plan
- Manually renew an existing customer
- Activation/renewal automatically consumes one unused code
- Renewal extends from the existing expiry if it is still active
- Admin password reset for customer accounts
- Customer counts shown in dashboard

Payment remains deferred.


SUPPORT + PROMOTIONS STAGE ADDED
- Public support/contact form
- Admin Support Inbox
- New / Open / Resolved message status
- Delete support messages
- Admin Promotions/Announcements manager
- Homepage promotion cards load from the database
- Site Settings manager
- Configurable support WhatsApp number
- Configurable support email
- Configurable World TV app version
- Configurable app download URL
- Download page automatically activates when an app URL is set
- Paystack remains deferred


NOTIFICATIONS + REPORTING STAGE
- Customer notification center inside My Account
- Admin can send a notification to one customer
- Admin can broadcast an announcement to all registered customers
- Customers can mark notifications as read
- Admin Reports dashboard
- Active and expired subscription counts
- Used and unused code counts
- Product/customer/support counts
- Recorded subscription revenue
- Recent subscription activity report

Paystack remains deferred until you are ready.


SECURITY + BACKUP STAGE
- Basic security response headers
- Login rate limiting
- Admin database backup download
- Customer CSV export
- Subscription-code CSV export
- Order/subscription CSV export
- Backup & Export section in Admin
- Production deployment checklist included
- Paystack remains deferred


WEBSITE CONTENT MANAGEMENT STAGE
- FAQ Manager in Admin
- Add/delete FAQ questions without editing HTML
- Public FAQ page loads directly from the database
- Custom website content manager
- Store reusable About/Help/Installation/Delivery text
- Existing customer, product, support, reports, backup and code tools retained
- Paystack remains deferred


PRODUCT ORDER MANAGEMENT STAGE
- Customers can order products directly on the World TV website
- Automatic World TV order numbers
- Quantity, customer details, delivery location and notes
- Order total calculation
- Public order tracking page
- Admin Product Orders dashboard
- Order statuses: New, Confirmed, Processing, Ready, Delivered, Cancelled
- Products still retain WhatsApp ordering as an alternative
- Payment remains deferred


COUPON + REFERRAL STAGE
- Admin coupon manager
- Fixed GH₵ or percentage discounts
- Coupons can target subscriptions, products or all purchases
- Usage limits and expiry dates
- Public coupon validation API ready for checkout
- Every customer can have a unique World TV referral code
- Referral code accepted during account registration
- Customer referral count in My Account
- Admin referral report
- Paystack remains deferred; coupons are prepared for the future checkout.


SUBSCRIPTION CHECKOUT PREPARATION STAGE
- Dedicated Subscribe page for the worldwide US$23/year promotional plan
- Logged-in customers can create subscription requests
- Coupon discounts are calculated before the request is saved
- Unique subscription reference number
- Admin Subscription Requests dashboard
- Admin can confirm an offline payment
- Admin can issue one unused subscription code after payment confirmation
- Customer receives an in-account activation notification
- Subscription expiry is calculated automatically
- Renewals extend an active subscription
- Coupon usage count increments only when the subscription is fulfilled
- Architecture is now prepared for Paystack to replace manual payment confirmation later


ADMIN ALERTS + AUDIT STAGE
- Admin Alerts center
- Low subscription-code inventory warning
- Pending subscription request warning
- New support-message warning
- New product-order warning
- 30-day subscription expiry warning
- Admin audit log for key subscription activation/fulfillment actions
- Searchable audit history
- Customer account renewal reminder when expiry is within 30 days
- Paystack remains deferred


EMAIL PREPARATION STAGE
- Admin Email Center
- Queue an email for one customer
- Queue broadcast emails for all registered customers
- Subscription activation automatically creates an email notification
- Email queue with queued/sent/failed status
- Audit log records email broadcasts
- EMAIL_SETUP.txt explains production email-provider integration
- External email delivery remains disabled until hosting/provider setup
- Paystack remains deferred


PASSWORD RESET STAGE
- Forgot Password page
- Secure random single-use reset tokens
- Reset tokens expire after 1 hour
- Reset requests do not reveal whether an email is registered
- Passwords are re-hashed with bcrypt
- Reset emails enter the existing email queue
- Password reset activity is recorded in the audit log
- PUBLIC_BASE_URL support for the final hosted domain
- Paystack remains deferred


DEPLOYMENT-READY STAGE
- Production npm start script
- Health-check endpoint at /health
- Public configuration endpoint
- Production configuration warnings
- .env.example for secure hosting variables
- .gitignore protects local secrets
- Dockerfile and docker-compose starter
- Hosting/domain deployment guide for MyWorldTVLive.com
- Launch Status page
- Paystack remains disabled until the public HTTPS deployment is ready


LAUNCH POLISH STAGE
- Terms of Service starter page
- Privacy Notice starter page
- Custom 404 page
- robots.txt
- sitemap.xml for MyWorldTVLive.com
- Homepage legal/support footer
- Final customer/admin/server launch test plan
- Paystack remains intentionally disabled


INSTALLABLE WEBSITE / PWA STAGE
- World TV web app manifest
- Service worker
- Offline fallback page
- Add-to-home-screen support
- Standalone app-style launch
- World TV icon metadata
- Launch-readiness API
- Native Android APK remains separate
- Paystack remains disabled


PUBLIC LAUNCH BRANDING STAGE
- Better public-page metadata
- World TV browser/site icon
- Social-sharing metadata
- Public service-status page
- Sensitive account/admin pages marked noindex
- Expanded robots.txt protection
- Updated sitemap
- Detailed MyWorldTVLive.com go-live instructions
- Paystack remains disabled
