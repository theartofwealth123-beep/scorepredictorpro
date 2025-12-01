// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');

const auth0Domain = process.env.AUTH0_DOMAIN;
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    if (session.mode === 'subscription') {
      const customerId = session.customer;
      const sub = await stripe.subscriptions.retrieve(session.subscription);

      const userId =
        session.client_reference_id || sub.metadata?.auth0_user_id;

      if (userId) {
        await fetch(`https://${auth0Domain}/api/v2/users/${userId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${managementToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            app_metadata: {
              stripeCustomerId: customerId,
              subStatus: sub.status === 'trialing' ? 'trialing' : 'active'
            }
          })
        });
      }
    }
  }

  // You can later add handling for subscription.deleted, invoice.payment_failed, etc.
  return { statusCode: 200, body: 'ok' };
};
