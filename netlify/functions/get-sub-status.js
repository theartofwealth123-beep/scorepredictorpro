// netlify/functions/get-sub-status.js
// Returns subscription status for current user using Auth0 app_metadata.

const fetch = require("node-fetch");

const auth0Domain = process.env.AUTH0_DOMAIN;
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;
const ADMIN_EMAIL = "theartofwealth123@gmail.com";

exports.handler = async (event) => {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return { statusCode: 401, body: "No token" };
  }

  try {
    // 1) Get basic user info from token
    const uiRes = await fetch(`https://${auth0Domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!uiRes.ok) throw new Error("Invalid token for userinfo");

    const user = await uiRes.json();

    // Admin bypass
    if (user.email === ADMIN_EMAIL) {
      return {
        statusCode: 200,
        body: JSON.stringify({ status: "active", email: user.email, admin: true })
      };
    }

    // 2) Fetch full user to read app_metadata.subStatus
    const userId = user.sub; // auth0|xxxx
    const fullRes = await fetch(
      `https://${auth0Domain}/api/v2/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!fullRes.ok) {
      console.error("Auth0 user fetch failed", await fullRes.text());
      return {
        statusCode: 200,
        body: JSON.stringify({ status: "free", email: user.email || null })
      };
    }

    const fullUser = await fullRes.json();
    const subStatus = fullUser.app_metadata?.subStatus || "free";

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: subStatus,
        email: user.email || null,
        admin: false
      })
    };
  } catch (err) {
    console.error("get-sub-status error:", err.message);
    return { statusCode: 401, body: "Invalid token" };
  }
};
