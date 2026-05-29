---
name: Home.tsx query key pattern
description: Generated hooks require explicit queryKey; omitting it causes TS2741 in home.tsx.
---

## Pattern
When calling `useSearchDocumentsV2` (or any generated hook) with custom query options, `queryKey` is required:

```ts
const params = { uploaderId: userId, status: "pending_review", pageSize: 3 } as const;
const { data } = useSearchDocumentsV2(params, {
  query: { queryKey: getSearchDocumentsV2QueryKey(params), staleTime: 60_000 },
});
```

**Why:** Orval-generated hooks type the second argument as `UseQueryOptions` which has `queryKey` as required. Passing only `{ staleTime }` without `queryKey` causes `TS2741: Property 'queryKey' is missing`.

**How to apply:** Import `getSearch*QueryKey` alongside `useSearch*` from `@workspace/api-client-react` whenever you need to pass custom query options to a generated hook.
