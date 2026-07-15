# Instagram publishing boundary

Use Instagram Login with a public Instagram professional Business account.
For a system serving only Perigee's owned account, Standard Access is
sufficient. Configure `instagram_business_basic` and
`instagram_business_content_publish`.

Current official references:

- Platform overview:
  https://developers.facebook.com/documentation/instagram-platform/overview
- Meta app setup with Instagram Login:
  https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app
- Instagram Login onboarding:
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
- Content publishing:
  https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Publishing quota:
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- Business login and token lifecycle:
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login

Use a Business-type Meta app and the **Manage messaging and content on
Instagram** use case. For one owned account, Standard Access does not require a
Facebook Page, App Review, Advanced Access, or Business Verification.

Publication flow:

1. Host every JPEG on a publicly reachable HTTPS URL and verify its SHA-256.
2. Verify `/me?fields=user_id,username,account_type` against the configured
   numeric ID and handle; require `Business`.
3. Query the live `content_publishing_limit`. Do not hardcode the quota because
   Meta's guides have reported different totals.
4. Create one `/<IG_ID>/media` child container per carousel image with
   `is_carousel_item=true` and alt text.
5. Create a `CAROUSEL` container with the ordered child IDs and caption.
6. Publish through `/<IG_ID>/media_publish`.
7. Read back the `CAROUSEL_ALBUM` and verify the media ID, permalink, caption,
   child count, image types, and alt-text order.

Never log access tokens or app secrets. Dashboard long-lived tokens are valid
for 60 days. Record their issuance locally, refresh a valid token after it is
at least 24 hours old and before expiry, and surface reauthorization failures.
An expired token cannot be refreshed. Confirm current Meta documentation
before changing API versions, scopes, limits, or token policy.
