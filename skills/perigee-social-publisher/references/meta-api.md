# Instagram publishing boundary

Use Instagram Login with a public Instagram professional Business account.
For a system serving only Perigee's owned account, Standard Access is
sufficient; use `instagram_business_basic` and
`instagram_business_content_publish`.

Current official references:

- Platform overview:
  https://developers.facebook.com/docs/instagram-platform/overview
- Meta app setup with Instagram Login:
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram
- Content publishing:
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/
- Business login and token lifecycle:
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login

Publication flow:

1. Host every JPEG on a publicly reachable HTTPS URL.
2. Create one `/<IG_ID>/media` child container per carousel image with
   `is_carousel_item=true` and alt text.
3. Create a `CAROUSEL` container with the ordered child IDs and caption.
4. Publish through `/<IG_ID>/media_publish`.
5. Read back the media object and verify its live permalink.

Never log access tokens or app secrets. Dashboard long-lived tokens are
typically valid for 60 days; refresh an eligible token before expiry and
surface reauthorization failures. Confirm current Meta documentation before
changing API versions, scopes, limits, or token policy.
