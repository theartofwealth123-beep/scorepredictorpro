const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const fetch = require("node-fetch");

const auth0Domain = process.env.AUTH0_DOMAIN || "dev-3cwuyjrqj751y7nr.us.auth0.com";
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;
const priceId = process.env.STRIPE_PRICE_ID;
const siteUrl = process.env.SITE_URL || "https://scorepredictor.pro";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "No token" })
    };
  }

  try {
    // 1) Get userinfo from Auth0 to verify token and get email/sub
    const uiRes = await fetch(`https://${auth0Domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!uiRes.ok) throw new Error("Invalid token");
    const user = await uiRes.json();
    const userId = user.sub;
    const userEmail = user.email;

    // 2) Get full user details (app_metadata) from Management API
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
    let customerId = fullUser.app_metadata?.stripeCustomerId;

    // 3) Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          auth0_user_id: userId
        }
      });
      customerId = customer.id;

      // Update Auth0 user with new stripeCustomerId
      await fetch(
        `https://${auth0Domain}/api/v2/users/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${managementToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            app_metadata: {
              stripeCustomerId: customerId
            }
          })
        }
      );
    }

    // 4) Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: "subscription",
      success_url: `${siteUrl}/auth-callback.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/profile.html`,
      client_reference_id: userId,
      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("create-checkout error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create checkout session" })
    };
  }
};
