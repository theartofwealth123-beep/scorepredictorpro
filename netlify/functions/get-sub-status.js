// netlify/functions/get-sub-status.js
const fetch = require('node-fetch');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

const client = jwksClient({
  jwksUri: 'https://dev-3cwuyjrqj751y7nr.us.auth0.com/.well-known/jwks.json'
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key?.publicKey || key?.rsaPublicKey;
    callback(null, signingKey);
  });
}

// CHANGE THESE TO YOUR REAL EMAILS
const ADMIN_EMAILS = [
  "theartofwealth123@gmail.com",     // ←←← PUT YOUR EMAIL HERE
  "backup@gmail.com"
];

exports.handler = async (event) => {
  const token = event.headers.authorization?.split(' ')[1];

  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };
  }

  try {
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        audience: "",  // can be empty for SPA
        issuer: "https://dev-3cwuyjrqj751y7nr.us.auth0.com/",
        algorithms: ["RS256"]
      }, (err, decoded) => err ? reject(err) : resolve(decoded));
    });

    // ADMIN BYPASS — FREE PREMIUM FOREVER
    if (ADMIN_EMAILS.includes(decoded.email)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ status: "active" })
      };
    }

    // Your existing Stripe logic goes here if you have it
    // For now just return free tier for everyone else
    return {
      statusCode: 200,
      body: JSON.stringify({ status: "free" })
    };

  } catch (error) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid token" })
    };
  }
};