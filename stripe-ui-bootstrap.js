"use strict";

// Stripe UI is loaded directly by subscribe.html.
// Do not wrap express.static here: intercepting static delivery can prevent
// /subscribe.html from completing in some deployments/browsers.
console.log("WORLD TV Stripe subscription UI uses direct page scripts");
