// netlify/functions/get-sub-status.js
exports.handler = async (event) => {
  const token = event.headers.authorization?.split(" ")[1];
  if (!token) return { statusCode: 401, body: "No token" };

  try {
    const res = await fetch("https://dev-3cwuyjrqj751y7nr.us.auth0.com/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Invalid token");

    const user = await res.json();

    // YOU = ADMIN FOREVER
    if (user.email === "theartofwealth123@gmail.com") {
      return { statusCode: 200, body: JSON.stringify({ status: "active" }) };
    }

    return { statusCode: 200, body: JSON.stringify({ status: "free" }) };
  } catch (err) {
    return { statusCode: 401, body: "Invalid token" };
  }
};