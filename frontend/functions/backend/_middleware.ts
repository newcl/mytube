import cloudflareAccess from '@cloudflare/pages-plugin-cloudflare-access';

export const onRequest = cloudflareAccess({
  domain: 'https://elladali.cloudflareaccess.com',
  aud: 'a4ee81736d61f40b009e4815eb4ef11ce2075c7f329fb8f3d95a44b24ee864c9',
});
