# Telegram Bot Setup Guide

## Step 1: Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Choose a name for your bot (e.g., "Stock Trading Bot")
4. Choose a username for your bot (must end with 'bot', e.g., "stock_trading_alerts_bot")
5. Copy the token provided by BotFather

## Step 2: Environment Configuration

Add the following to your `.env` file:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_WEBHOOK_SECRET=your_optional_webhook_secret
FRONTEND_URL=https://yourplatform.com
```

## Step 3: Install Dependencies

The required dependencies are already added to package.json:

```bash
npm install
```

## Step 4: Database Migration

The system will automatically create the required collections when you first run the application. The new models are:

- `telegramgroups`
- `telegraminvitelinks`  
- `telegramusers`

## Step 5: Create Telegram Groups

1. Create your trading groups on Telegram
2. Add your bot as an administrator with the following permissions:
   - Delete messages
   - Ban users
   - Invite users via link
   - Pin messages (optional)

## Step 6: Get Chat IDs

To get the chat ID of your groups:

1. Add the bot to your group
2. Send a message in the group
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for the chat object in the response, the `id` field is your chat ID

Example response:
```json
{
  "chat": {
    "id": -1001234567890,
    "title": "Premium Trading Group",
    "type": "supergroup"
  }
}
```

## Step 7: Map Groups to Products

Use the admin API to create group mappings:

```bash
curl -X POST http://localhost:3000/api/telegram/groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "chatId": "-1001234567890",
    "groupTitle": "Premium Trading Group",
    "productType": "Portfolio",
    "productId": "your_portfolio_id",
    "category": "premium",
    "welcomeMessage": "Welcome to our premium trading group! Please follow the rules.",
    "maxMembers": 500
  }'
```

## Step 8: Test the Integration

1. Start your application
2. The bot should initialize automatically
3. Test generating an access link for a user with an active subscription
4. Test the link by joining the group

## Step 9: Production Deployment

For production deployment:

1. Set up webhook for Telegram (optional but recommended for better reliability):
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://yourapi.com/telegram/webhook"}'
   ```

2. Configure proper logging directory permissions
3. Set up monitoring for the cron jobs
4. Configure SSL for webhook endpoints

## Testing Commands

Once setup is complete, users can test these bot commands:

- `/start` - Bot introduction
- `/help` - Available commands
- `/status` - Check subscription status

## Admin Testing

Test the admin endpoints:

```bash
# Get all groups
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  http://localhost:3000/api/telegram/admin/groups

# Get statistics
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  http://localhost:3000/api/telegram/admin/stats

# Manual cleanup
curl -X POST -H "Authorization: Bearer ADMIN_TOKEN" \
  http://localhost:3000/api/telegram/admin/cleanup/expired
```

## Troubleshooting

### Bot Not Starting
- Verify TELEGRAM_BOT_TOKEN is correct
- Check internet connectivity
- Ensure bot is not blocked by Telegram

### Users Not Getting Removed
- Check cron jobs are running
- Verify bot has admin permissions in groups
- Check subscription expiry dates in database

### Links Not Working
- Verify group mappings exist
- Check bot permissions to create invite links
- Ensure links haven't expired

### Database Issues
- Check MongoDB connection
- Verify all models are properly imported
- Check for any validation errors in logs

## Security Considerations

1. Keep bot token secret and never commit to version control
2. Use webhook secrets for production
3. Regularly rotate tokens if compromised
4. Monitor for unusual activity
5. Implement rate limiting for user requests

## Monitoring

Monitor these aspects:

- Bot uptime and connectivity
- Cron job execution
- Database performance
- User removal success rate
- Link generation/usage patterns
- Group member counts

Check logs regularly:
- `logs/telegram-bot.log`
- `logs/telegram-service.log` 
- `logs/telegram-controller.log`
- `logs/telegram-cron.log`