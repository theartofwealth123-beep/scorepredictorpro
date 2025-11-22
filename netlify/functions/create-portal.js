// netlify/functions/create-portal.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const { user } = context.clientContext?.identity || {};
  if (!user || !user.app_metadata?.stripeCustomerId) {
    return { statusCode: 400, body: JSON.stringify({ error: "No subscription" }) };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.app_metadata.stripeCustomerId,
    return_url: process.env.SITE_URL,
  });

  return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
};