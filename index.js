addEventListener("fetch", (event) => {
  event.respondWith(
    handleRequest(event).catch(
      (err) => new Response(err.stack, { status: 500 })
    )
  );
});

async function sha256(message) {
  // encode as UTF-8
  const msgBuffer = new TextEncoder().encode(message)

  // hash the message
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer)

  // convert ArrayBuffer to Array
  const hashArray = Array.from(new Uint8Array(hashBuffer))

  // convert bytes to hex string
  const hashHex = hashArray.map(b => ("00" + b.toString(16)).slice(-2)).join("")
  return hashHex
}

async function handleRequest(event) {
  const request = event.request;

  // Only GET requests work with this proxy
  if (request.method !== 'GET' && request.method !== 'POST') {
    return MethodNotAllowed(request);
  }

  const { pathname } = new URL(request.url);

  if (!pathname.startsWith("/chains") && pathname !== "/injection/operation") {
    return RPCNotAllowed(pathname);
  }

  if (request.method === 'GET') {
    // Construct the cache key from the cache URL
    const cacheUrl = request.url;
    const cacheKey = cacheUrl; // new Request(cacheUrl.toString(), request);
    const cache = caches.default;

    // Check whether the value is already available in the cache
    // if not, you will need to fetch it from origin, and store it in the cache
    // for future access
    let response = await cache.match(cacheKey);

    if (!response) {
      // If not in cache, get it from origin
      const randomNode = getRandomNode();
      const url = randomNode + pathname;
      const rpcRequest = new Request(url, {
        body: request.body,
        headers: request.headers,
        method: 'GET',
      })
      response = await fetch(rpcRequest);

      if (response.status === 200) {
        // Must use Response constructor to inherit all of response's fields
        response = new Response(response.body);

        // If it's a head request, cache for 10 seconds, otherwise 10 minutes
        const maxAge = /blocks\/head/.test(pathname) ? 10 : 600;

        // Cache API respects Cache-Control headers. Setting s-max-age to N
        // will limit the response to be in cache for N seconds max

        // Any changes made to the response here will be reflected in the cached value
        response.headers.append("Cache-Control", `max-age=${maxAge}, s-maxage=${maxAge}`);
        response.headers.append("Node-Origin", randomNode);

        // Store the fetched response as cacheKey
        // Use waitUntil so you can return the response without blocking on
        // writing to cache
        event.waitUntil(cache.put(cacheKey, response.clone()));
      } else {
        return UnknownError();
      }
    }

    return response;
  } else {
    // Method: POST
    if (pathname.startsWith("/chains")) {
      const body = await request.clone().text();

      // Hash the request body to use it as a part of the cache key
      const hash = await sha256(body);
      const cacheUrl = new URL(request.url);

      // Store the URL in cache
      cacheUrl.pathname = cacheUrl.pathname + hash;

      // Convert to a GET to be able to cache
      const cacheKey = new Request(cacheUrl.toString(), {
        headers: request.headers,
        method: "GET",
      });

      const cache = caches.default;

      // Find the cache key in the cache
      let response = await cache.match(cacheKey);

      // Otherwise, fetch response to POST request from origin
      if (!response) {
        // If not in cache, get it from origin
        const randomNode = getRandomNode();
        const url = randomNode + pathname;
        const rpcRequest = new Request(url, {
          body: request.body,
          headers: request.headers,
          method: 'POST',
        })
        response = await fetch(rpcRequest);

        if (response.status === 200) {
          // Must use Response constructor to inherit all of response's fields
          response = new Response(response.body);

          // If it's a head request, cache for 10 seconds, otherwise 10 minutes
          const maxAge = /blocks\/head/.test(pathname) ? 10 : 600;

          // Cache API respects Cache-Control headers. Setting s-max-age to N
          // will limit the response to be in cache for N seconds max

          // Any changes made to the response here will be reflected in the cached value
          response.headers.append("Cache-Control", `max-age=${maxAge}, s-maxage=${maxAge}`);
          response.headers.append("Node-Origin", randomNode);

          // Store the fetched response as cacheKey
          // Use waitUntil so you can return the response without blocking on
          // writing to cache
          event.waitUntil(cache.put(cacheKey, response.clone()));
        } else {
          return UnknownError();
        }
      }

      return response;
    } else {
      const randomNode = getRandomNode();
      const url = randomNode + pathname;
      const rpcRequest = new Request(url, {
        body: request.body,
        headers: request.headers,
        method: 'POST',
      })
      const response = await fetch(rpcRequest);

      if (response.status === 200) {
        return new Response(response.body, response);
      } else {
        return UnknownError();
      }
    }
  }
}

const getRandomNode = () => {
  const nodes = [
    'https://mainnet.smartpy.io',
    'https://mainnet.api.tez.ie',
    'https://tezos-prod.cryptonomic-infra.tech',
    'https://rpc.tzkt.io/mainnet',
  ];
  return nodes[Math.floor(Math.random() * nodes.length)]; 
}

function MethodNotAllowed(request) {
  return new Response(`Method ${request.method} not allowed.`, {
    status: 405,
    headers: {
      'Allow': 'GET, POST'
    }
  });
}

function RPCNotAllowed(pathname) {
  return new Response(`RPC ${pathname} not allowed.`, {
    status: 403,
  });
}

function RPCTimeout() {
  return new Response(`RPC timed out. Please try again later.`, {
    status: 408,
  });
}

function UnknownError() {
  return new Response(`An error occurred. Please try again later.`, {
    status: 404,
  });
}