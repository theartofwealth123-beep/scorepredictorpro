// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth0Domain = process.env.AUTH0_DOMAIN;
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN; // get from Auth0 → APIs → Management API → create token with "update:users"

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) { return { statusCode: 400 } }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    if (session.mode === 'subscription') {
      const customerId = session.customer;
      const sub = await stripe.subscriptions.retrieve(session.subscription);

      // Update Auth0 user metadata
      await fetch(`https://${auth0Domain}/api/v2/users/${session.client_reference_id || sub.metadata.auth0_user_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${managementToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_metadata: {
            {
            stripeCustomerId: customerId,
            subStatus: sub.status === 'trialing' ? 'trialing' : 'active'
          }
        })
      });
    }
  }

  if (stripeEvent.type.includes('subscription.deleted') || stripeEvent.type.includes('payment_failed')) {
    // mark as canceled / past_due in Auth0
  }

  return { statusCode: 200 };
};