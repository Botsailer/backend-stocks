# Swagger Documentation for Telegram APIs

## Overview
All Telegram bot integration APIs are fully documented with Swagger/OpenAPI 3.0 specification.

## Access Swagger Documentation
- **UI**: http://localhost:3000/api-docs
- **JSON**: http://localhost:3000/api-docs.json

## Swagger Configuration Updated
The swagger configuration has been updated to include:
- Enhanced API information with contact and license
- Security schemes for JWT authentication
- Both routes and controllers scanning for documentation
- Development and production server configurations

## Complete List of Telegram API Endpoints with Swagger Documentation

### 🔐 Authentication
All endpoints require JWT Bearer token authentication except where noted.

### 📊 User Endpoints

#### 1. Generate Access Link
```
POST /api/telegram/generate-link
```
**Tags**: `Telegram`  
**Summary**: Generate access link for user's subscription  
**Security**: Bearer Auth Required  
**Request Body**:
```json
{
  "productType": "Portfolio", // or "Bundle"
  "productId": "product_id_here"
}
```

#### 2. Get User's Telegram Groups
```
GET /api/telegram/user/groups
```
**Tags**: `Telegram`  
**Summary**: Get user's Telegram groups  
**Security**: Bearer Auth Required  

#### 3. Revoke Access Link
```
POST /api/telegram/links/{linkId}/revoke
```
**Tags**: `Telegram`  
**Summary**: Revoke an access link  
**Security**: Bearer Auth Required  
**Parameters**: `linkId` (path parameter)

### 🏷️ Product-Specific Endpoints

#### 4. Portfolio Telegram Access
```
POST /api/portfolios/{id}/telegram/access-link
```
**Tags**: `Portfolio, Telegram`  
**Summary**: Generate Telegram group access link for portfolio  
**Security**: Bearer Auth Required  
**Parameters**: `id` (Portfolio ID)  
**Response Example**:
```json
{
  "success": true,
  "message": "Telegram access link generated successfully",
  "data": {
    "linkId": "abc123def456",
    "inviteLink": "https://t.me/+AbCdEfGhIjKlMnOp",
    "expiresAt": "2024-12-07T10:30:00Z",
    "subscriptionExpiresAt": "2025-01-07T10:30:00Z",
    "maxUses": 1,
    "currentUses": 0,
    "portfolio": {
      "id": "portfolio_id",
      "name": "Portfolio Name"
    }
  }
}
```

#### 5. Bundle Telegram Access
```
POST /api/bundles/{id}/telegram/access-link
```
**Tags**: `Bundle, Telegram`  
**Summary**: Generate Telegram group access link for bundle  
**Security**: Bearer Auth Required  
**Parameters**: `id` (Bundle ID)  
**Response Example**:
```json
{
  "success": true,
  "message": "Telegram access link generated successfully", 
  "data": {
    "linkId": "def456abc789",
    "inviteLink": "https://t.me/+XyZaBcDeFgHiJkLm",
    "expiresAt": "2024-12-07T10:30:00Z",
    "subscriptionExpiresAt": "2025-01-07T10:30:00Z",
    "maxUses": 1,
    "currentUses": 0,
    "bundle": {
      "id": "bundle_id",
      "name": "Bundle Name"
    }
  }
}
```

### 👨‍💼 Admin Endpoints (Require Admin Role)

#### 6. Create Group Mapping
```
POST /api/telegram/groups
```
**Tags**: `Telegram`  
**Summary**: Create or update Telegram group mapping  
**Security**: Bearer Auth Required (Admin)  
**Request Body**:
```json
{
  "chatId": "-1001234567890",
  "groupTitle": "Premium Trading Group",
  "productType": "Portfolio",
  "productId": "product_id",
  "category": "premium",
  "welcomeMessage": "Welcome!",
  "maxMembers": 100
}
```

#### 7. Get All Groups
```
GET /api/telegram/admin/groups
```
**Tags**: `Telegram`  
**Summary**: Get all Telegram groups (Admin only)  
**Security**: Bearer Auth Required (Admin)  

#### 8. Update Group
```
PUT /api/telegram/admin/groups/{groupId}
```
**Tags**: `Telegram`  
**Summary**: Update Telegram group (Admin only)  
**Security**: Bearer Auth Required (Admin)  
**Parameters**: `groupId` (path parameter)

#### 9. Manual Cleanup - Expired Users
```
POST /api/telegram/admin/cleanup/expired
```
**Tags**: `Telegram`  
**Summary**: Remove expired users from groups (Admin only)  
**Security**: Bearer Auth Required (Admin)  

#### 10. Manual Cleanup - Expired Links
```
POST /api/telegram/admin/cleanup/links
```
**Tags**: `Telegram`  
**Summary**: Cleanup expired links (Admin only)  
**Security**: Bearer Auth Required (Admin)  

#### 11. Kick User
```
POST /api/telegram/admin/users/{telegramUserId}/kick
```
**Tags**: `Telegram`  
**Summary**: Kick user from all groups (Admin only)  
**Security**: Bearer Auth Required (Admin)  
**Parameters**: `telegramUserId` (path parameter)  
**Request Body**:
```json
{
  "reason": "Policy violation"
}
```

#### 12. Get Statistics
```
GET /api/telegram/admin/stats
```
**Tags**: `Telegram`  
**Summary**: Get Telegram bot statistics (Admin only)  
**Security**: Bearer Auth Required (Admin)  
**Response Example**:
```json
{
  "success": true,
  "data": {
    "groups": {
      "total": 10,
      "active": 8,
      "inactive": 2
    },
    "users": {
      "total": 150
    },
    "links": {
      "active": 25,
      "expired": 45,
      "total": 70
    }
  }
}
```

## Common Response Schemas

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { /* response data */ }
}
```

### Error Response
```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

### Common HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors, missing subscription)
- `401` - Unauthorized (invalid/missing JWT token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource not found)
- `500` - Internal Server Error

## Security Configuration

### JWT Authentication
```yaml
securitySchemes:
  bearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
    description: "Enter JWT token"
```

### Usage in Requests
```
Authorization: Bearer <your-jwt-token>
```

## Server Configurations

### Development Server
```
http://localhost:3000
```

### Production Server
```
https://api.yourplatform.com
```

## Validation Rules

### Required Fields
- All POST/PUT requests validate required fields
- JWT token required for all endpoints
- Admin role required for admin endpoints

### Data Validation
- Product IDs must be valid MongoDB ObjectIds
- Chat IDs must be valid Telegram chat IDs
- Subscription status must be 'active'
- Product types limited to 'Portfolio' or 'Bundle'

## Error Handling
All endpoints include comprehensive error handling with:
- Detailed error messages
- Appropriate HTTP status codes
- Validation error details
- Structured error responses

## Testing the Documentation
1. Start your server: `npm run start`
2. Visit: http://localhost:3000/api-docs
3. Use the interactive Swagger UI to test endpoints
4. Get raw JSON schema: http://localhost:3000/api-docs.json

## Features Documented
✅ All 12+ Telegram API endpoints  
✅ Request/Response schemas  
✅ Authentication requirements  
✅ Error responses  
✅ Example payloads  
✅ Parameter descriptions  
✅ Tag-based organization  
✅ Security configurations  
✅ Server configurations  

The Telegram bot integration is fully documented and ready for API consumption!