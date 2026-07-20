# Meta publishing boundaries

## Instagram

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
   Include `location_id` only when it is the verified ID of an existing place
   configured for the selected station. If no verified ID is available, do not
   guess: preserve the suggested place in the manifest and require a manual
   location edit after publication.
6. Publish through `/<IG_ID>/media_publish`.
7. Read back the `CAROUSEL_ALBUM` and verify the media ID, permalink, caption,
   child count, image types, and alt-text order.
8. When location delivery is manual, add the existing place in Instagram and
   verify the place on the live post before marking the location step complete.

Never log access tokens or app secrets. Dashboard long-lived tokens are valid
for 60 days. Record their issuance locally, refresh a valid token after it is
at least 24 hours old and before expiry, and surface reauthorization failures.
An expired token cannot be refreshed. Confirm current Meta documentation
before changing API versions, scopes, limits, or token policy.

## Facebook Page

Create an owned Facebook Page for Perigee Tides, connect it to the
`@perigeetides` Instagram professional account, and add the **Manage everything
on your Page** use case to the existing Perigee Social Publisher app. The owned
Page flow uses `pages_show_list`, `pages_read_engagement`, and
`pages_manage_posts`. Keep the Page access token private and install it only
through `npm run facebook-token:install -- --confirm` on piped stdin.

Current official references:

- Pages API: https://developers.facebook.com/docs/pages-api/
- Page posts: https://developers.facebook.com/docs/pages-api/posts/
- Page feed edge: https://developers.facebook.com/docs/graph-api/reference/page/feed/
- Page photos edge: https://developers.facebook.com/docs/graph-api/reference/page/photos/
- Connect a Page and Instagram account:
  https://www.facebook.com/help/1148909221857370

Publication flow:

1. Verify `/<PAGE_ID>?fields=id,name,username,link` against the configured Page
   ID, exact name, optional username, and public link.
2. Reverify all five public JPEGs and SHA-256 values.
3. Upload one unpublished `/<PAGE_ID>/photos` object per ordered slide with
   `published=false` and `alt_text_custom`.
4. Create one `/<PAGE_ID>/feed` post with the Facebook-specific caption and
   ordered `attached_media[n]` photo IDs.
5. Read back the post and verify ID, permalink, Facebook caption, five-photo
   count, and photo order before writing the Facebook ledger entry.

Facebook uses its own journal below `state/publishing/facebook/`. If the feed
write is ambiguous, rerun the same `npm run publish` command so the publisher
can reconcile a recent Page post with the exact caption and photo order. Never
delete the journal or submit the feed post another way. An Instagram success
does not make a Facebook failure complete, and vice versa.
