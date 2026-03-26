

## Admin Impersonation — Plan

### What it does
Lets an admin temporarily "see the app as a member" without logging out. A client-side-only role override stored in React context. No database changes, no session swapping — just suppresses the admin role in the UI so `useIsAdmin()` returns `false`.

A visible banner at the top warns you're impersonating, with a button to stop.

### How it works

**1. Create `src/hooks/useImpersonation.tsx`** — React context + provider
- Stores `impersonatedRole: "member" | null` in state (sessionStorage-backed so it survives page refresh but not tab close)
- Provides `startImpersonating(role)`, `stopImpersonating()`, `impersonatedRole`
- Wrap the app with `<ImpersonationProvider>`

**2. Modify `src/hooks/useIsAdmin.ts`**
- Import impersonation context
- If `impersonatedRole === "member"`, return `isAdmin: false` regardless of DB result
- The real admin status is still fetched and cached — just masked

**3. Modify `src/components/AppHeader.tsx`** — User dropdown menu
- Import `useIsAdmin` and `useImpersonation`
- If user is a real admin and not currently impersonating: show "Impersonate" item with a sub-menu containing "Member"
- If currently impersonating: show "Stop Impersonating" item instead
- Uses `DropdownMenuSub` / `DropdownMenuSubTrigger` / `DropdownMenuSubContent` for the flyout sub-menu sliding left

**4. Add impersonation banner** — in `AppHeader.tsx` or `AppLayout.tsx`
- When impersonating, render a small amber/warning bar below the header: "Viewing as Member — [Stop]"
- Keeps it obvious you're in impersonation mode

**5. Wire provider in `src/App.tsx`**
- Wrap app content with `<ImpersonationProvider>` inside `<AuthProvider>`

### Files changed
| File | Change |
|------|--------|
| `src/hooks/useImpersonation.tsx` | New — context + provider |
| `src/hooks/useIsAdmin.ts` | Check impersonation context, mask admin |
| `src/components/AppHeader.tsx` | Add Impersonate sub-menu + banner |
| `src/App.tsx` | Add `<ImpersonationProvider>` |

### What it does NOT do
- No database changes or new tables
- No actual auth session changes — your real JWT/session stays admin
- No server-side impersonation — this is purely UI-level role masking
- Does not touch `useAdminApi` calls (admin API endpoints still work if called directly, but UI gates will hide admin features)

