# Question content blocks

DecodedSAT keeps `questions.prompt` as the legacy/searchable question body and
adds nullable `questions.content_blocks` JSONB. A `NULL` value always renders
`prompt` through the original single-dollar inline-LaTeX path. No existing row
is rewritten by the migration.

When blocks are present they are authoritative. Admin create/edit also stores a
plain fallback assembled from the blocks in `prompt`, so compact search results
and an older application deployment still have readable content.

## Stored shape

```json
[
  {
    "id": "c0a80101-0000-4000-8000-000000000001",
    "type": "text",
    "content": "The value of $x$ is $\\frac{5}{3}$."
  },
  {
    "id": "c0a80101-0000-4000-8000-000000000002",
    "type": "centered_math",
    "content": "\\frac{x+4}{3}=8"
  },
  {
    "id": "c0a80101-0000-4000-8000-000000000003",
    "type": "image",
    "storagePath": "questions/QUESTION_UUID/ASSET_UUID.png",
    "alt": "Right triangle ABC with altitude CD perpendicular to AB.",
    "caption": "",
    "size": "medium"
  },
  {
    "id": "c0a80101-0000-4000-8000-000000000004",
    "type": "table",
    "header": true,
    "rows": [["$x$", "$f(x)$"], ["1", "4"], ["2", "7"]]
  }
]
```

Text and table cells use the existing `$...$` inline syntax. A centered-math
block stores raw LaTeX without dollar delimiters; the shared renderer selects
KaTeX display mode. Arbitrary HTML is not a block type and is never rendered.

TypeScript/Zod validation lives in `src/lib/questions/content.ts`; a matching
PostgreSQL check function and constraint provide a second persistence boundary.

## JSON imports

The existing `prompt` key remains supported. `question_text` is accepted as an
alias. `content_blocks` is optional, and a fallback prompt is derived when a
rich import provides neither text key. Practice-test imports accept the same
blocks plus their existing `module_number` field.

The normal way to add an image is the admin block editor. It uploads through a
server action into the `question-assets` bucket, never through a service-role
key in the browser. Rich JSON image blocks can only reference an asset path
that already exists in that bucket.

## Storage lifecycle

Admin uploads use `questions/{question-id}/{asset-uuid}.{ext}`. PNG, JPEG, and
WebP are accepted up to 5 MB after extension, MIME, and file-signature checks.
SVG is intentionally unsupported. Replaced/removed persisted images are deleted
after save only when the database confirms no other question references them.
Soft-deactivating a question retains its figures so restoring it is safe.
