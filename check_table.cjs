
const { query } = require('./backend/src/services/pgClient');
query("SELECT to_regclass('public.error_logs')")
    .then(res => console.log(res.rows[0]))
    .catch(err => console.error(err));
