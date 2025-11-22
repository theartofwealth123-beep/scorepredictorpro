// netlify/functions/get-sub-status.js
exports.handler = async (event, context) => {
  const { user } = context.clientContext?.identity || {};
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthenticated" }) };

  const status = user.app_metadata?.subStatus || "free";
  return {
    statusCode: 200,
    body: JSON.stringify({ status }) // free | trialing | active | canceled | past_due
  };
};