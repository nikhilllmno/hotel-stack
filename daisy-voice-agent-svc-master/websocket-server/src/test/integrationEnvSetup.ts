// On Windows (and some Node 22.12+ setups), localhost resolves to IPv6-only while
// Docker binds exposed ports on IPv4, causing "No host port found for host IP".
// See: https://github.com/testcontainers/testcontainers-node/issues/818
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.1';
