// netlify/functions/stripe-webhook.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const fetch = require("node-fetch");

const auth0Domain = process.env.AUTH0_DOMAIN;
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;

exports.handler = async (event) => {
  const sig =
    event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe signature error:", err.message);
    return { statusCode: 400, body: "Invalid signature" };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      if (session.mode === "subscription") {
        const customerId = session.customer;
        const sub = await stripe.subscriptions.retrieve(session.subscription);

        const auth0UserId =
          session.client_reference_id || sub.metadata?.auth0_user_id;
        if (auth0UserId) {
          await fetch(
            `https://${auth0Domain}/api/v2/users/${encodeURIComponent(
              auth0UserId
            )}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${managementToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                app_metadata: {
                  stripeCustomerId: customerId,
                  subStatus: sub.status === "trialing" ? "trialing" : "active"
                }
              })
            }
          ).catch((e) =>
            console.error("Auth0 metadata update failed:", e.message)
          );
        }
      }
    }

    // Handle cancellations / failures
    if (
      stripeEvent.type === "customer.subscription.deleted" ||
      stripeEvent.type === "invoice.payment_failed"
    ) {
      const sub = stripeEvent.data.object;
      const auth0UserId = sub.metadata?.auth0_user_id;
      if (auth0UserId) {
        await fetch(
          `https://${auth0Domain}/api/v2/users/${encodeURIComponent(
            auth0UserId
          )}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${managementToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              app_metadata: {
                subStatus:
                  stripeEvent.type === "customer.subscription.deleted"
                    ? "canceled"
                    : "past_due"
              }
            })
          }
        ).catch((e) =>
          console.error("Auth0 cancel/past_due update failed:", e.message)
        );
      }
    }
  } catch (e) {
    console.error("stripe-webhook handler error:", e.message);
  }

  return { statusCode: 200, body: "OK" };
};
