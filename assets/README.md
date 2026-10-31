# Set the social preview

[social-preview.png](social-preview.png) is the approved launch card. It uses
the tray `e` icon, the repository name, the Codex login description, and the
alpha status. The PNG is 1200 × 600 pixels and under 1 MB. It matches GitHub's
2:1 image ratio and exceeds its minimum size of 640 × 320 pixels.

![einsager social preview](social-preview.png)

## Upload the image once

A commit does not set GitHub's social preview. A repository administrator
must upload the image in Settings. GitHub's GraphQL `updateRepository` input
has no social preview field.

1. Download [social-preview.png](social-preview.png) with **Download raw file**.
2. Open the repository's [General settings](https://github.com/MaximilianMauroner/einsager/settings).
3. Under **Social preview**, click **Edit → Upload an image…**.
4. Select the downloaded PNG and confirm the crop if GitHub asks.

See [GitHub's social preview instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Share and check the link

Use <https://github.com/MaximilianMauroner/einsager> for launch posts. The
README links to the latest release under **Install**. The repository
description already states the supported systems, the Codex login, and the
alpha status.

After the upload, check that GitHub reports a custom image:

```sh
gh api graphql -f query='query { repository(owner:"MaximilianMauroner", name:"einsager") { usesCustomOpenGraphImage openGraphImageUrl } }'
```

`usesCustomOpenGraphImage` must be `true`. Open `openGraphImageUrl` and check
that it shows the uploaded card. To inspect the metadata for both share URLs:

```sh
curl -fsSL https://github.com/MaximilianMauroner/einsager | rg 'property="og:image"|name="twitter:image"'
curl -fsSL https://github.com/MaximilianMauroner/einsager/releases/tag/v0.1.1 | rg 'property="og:image"|name="twitter:image"'
```

Open each image URL to check the result. GitHub controls release page
metadata separately. Do not assume that the repository image replaces a
release card. If the release still has a generated card, share the repository
URL.

Check the repository URL in a new X post draft before posting. X and other
social sites can cache cards, so an existing post can keep the old image.
Check the draft on each site where you plan to share the link.
