// Optional restricted-container workaround: preserve real interfaces when available.
// Wrangler enumerates LAN addresses even when bound explicitly to loopback.
// This does not alter fetch/network routing or enable remote access.
const os = require('node:os');
const real = os.networkInterfaces;
os.networkInterfaces = function () {
  try { return real(); }
  catch (error) {
    if (error.code !== 'ERR_SYSTEM_ERROR' || error.info?.syscall !== 'uv_interface_addresses') throw error;
    return { lo: [{ address:'127.0.0.1', netmask:'255.0.0.0', family:'IPv4', mac:'00:00:00:00:00:00', internal:true, cidr:'127.0.0.1/8' }] };
  }
};
