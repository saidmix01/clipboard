const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

module.exports = {
  BACKEND_URL: isDev
    ? 'http://localhost:3000'
    : 'https://backend-copyfy.onrender.com'
}
