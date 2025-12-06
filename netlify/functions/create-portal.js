// netlify/functions/create-portal.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const fetch = require("node-fetch");

const auth0Domain = process.env.AUTH0_DOMAIN;
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;

exports.handler = async (event) => {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "No token" })
    };
  }

  try {
    // 1) Get userinfo
    const uiRes = await fetch(`https://${auth0Domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!uiRes.ok) throw new Error("Invalid token");
    const user = await uiRes.json();
    const userId = user.sub;

    // 2) Get full user for app_metadata.stripeCustomerId
    const fullRes = await fetch(
      `https://${auth0Domain}/api/v2/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (!fullRes.ok) throw new Error("Cannot load Auth0 user");

    const fullUser = await fullRes.json();
    const customerId = fullUser.app_metadata?.stripeCustomerId;
    if (!customerId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No subscription customer found" })
      };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.SITE_URL || "https://example.com"
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("create-portal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create portal session" })
    };
  }
};
