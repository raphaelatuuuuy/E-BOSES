# Authentication & Role-Based Access Control

## Overview

E-Boses uses **JWT (JSON Web Token)** authentication with **Role-Based Access Control (RBAC)** to manage user permissions across four roles:

| Role | Description |
|---|---|
| **Resident** | Can submit concerns, send emergency alerts, track reports, support concerns |
| **Barangay Official** | Can review/validate concerns, prioritize, coordinate response |
| **Responder** | Can view and respond to assigned emergency alerts |
| **Admin** | Full system access, user management, audit logs |

## User Verification Flow

```
Register → Pending OTP → Enter OTP → Pending ID Review → Verified
                                                         ↓
                                                    Rejected
                                                    Suspended
```

1. **Registration**: User creates account with email + password
2. **OTP Verification**: One-time code sent to email (placeholder)
3. **ID Review**: OCR validation of uploaded ID (placeholder)
4. **Verified**: Full access granted
5. **Rejected/Suspended**: Access restricted

## JWT Authentication

### Token Structure

```json
{
  "access": "eyJhbGciOiJIUzI1NiIs...",
  "refresh": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "full_name": "Juan Dela Cruz",
    "role": "resident",
    "verification_status": "verified"
  }
}
```

### Token Storage (Frontend)

- `access_token` — stored in `localStorage`
- `refresh_token` — stored in `localStorage`
- Access token expires in 30 minutes (configurable)
- Refresh token expires in 7 days (configurable)

### Token Refresh Flow

```
Request → 401 Unauthorized → Try Refresh → Success → Retry Request
                                        → Fail → Clear Tokens → Redirect Login
```

## RBAC Permission Classes (Backend)

```python
from modules.accounts.permissions import IsResident, IsBarangayOfficial, IsResponder, IsAdmin

class ConcernListView(APIView):
    permission_classes = [IsBarangayOfficial | IsAdmin]
```

## Frontend Route Protection

### Protected Routes

```tsx
<ProtectedRoute>
  <MainLayout />
</ProtectedRoute>
```

Redirects to `/login` if user is not authenticated.

### Public Routes

```tsx
<PublicRoute>
  <LoginPage />
</PublicRoute>
```

Redirects to `/dashboard` if user is already authenticated.

### Role-Based Dashboard Redirect

```
/dashboard/ → /dashboard/resident   (if role = resident)
           → /dashboard/barangay   (if role = barangay_official)
           → /dashboard/responder  (if role = responder)
           → /dashboard/admin      (if role = admin)
```

## Next Steps for Auth Implementation

1. Wire up actual JWT login/logout in AuthContext
2. Add ID upload and OCR verification flow
3. Implement token persistence on page reload
4. Add route-level permission checks (e.g., user can only access their own dashboard)
5. Add email verification UI
6. Add password reset flow
