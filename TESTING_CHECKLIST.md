# Testing Checklist - Refactored Bot

## Pre-Deployment Testing

### Module Loading Tests
- [x] ✅ All helper modules load without errors
- [x] ✅ All refactored commands load without errors
- [x] ✅ embedBuilders.js loads without errors
- [x] ✅ No syntax errors in any JavaScript files

### Environment Setup
- [ ] Verify .env file has all required variables:
  - [ ] `BOT_TOKEN` - Discord bot token
  - [ ] `STORAGE_CHANNEL_ID` - Discord storage channel ID
  - [ ] `NEWS_CHANNEL_ID` - News channel ID (optional)
  - [ ] `PORT` - Server port (default: 10000)
- [ ] Verify trainerData.json exists or can be created
- [ ] Verify pokemonData.json exists
- [ ] Verify trainerSprites.json exists
- [ ] Verify public/sprites directory exists with images

## Command Testing

### /daily Command
- [ ] Command shows up in Discord slash commands
- [ ] Can claim daily reward successfully
- [ ] Cooldown works correctly (24 hours)
- [ ] Shows proper error message when on cooldown
- [ ] Pokemon selection menu appears
- [ ] Trainer selection menu appears
- [ ] Pokemon reward is added to collection
- [ ] Trainer reward is added to collection
- [ ] TP and CC are credited correctly
- [ ] Shiny Pokemon can appear
- [ ] Data is saved after claiming

### /recruit Command
- [ ] Command shows up in Discord slash commands
- [ ] Selection menu appears (Pokemon/Trainer)
- [ ] Pokemon recruitment works
- [ ] Trainer recruitment works
- [ ] Cancel button works
- [ ] Timeout handling works (2 minutes)
- [ ] Data is saved after recruitment

### /quest Command
- [ ] Command shows up in Discord slash commands
- [ ] Random reward is given (Pokemon or Trainer)
- [ ] Pokemon rewards work correctly
- [ ] Trainer rewards work correctly
- [ ] Shiny Pokemon can appear
- [ ] Data is saved after quest

### /gift Command
- [ ] Command shows up in Discord slash commands
- [ ] Can gift CC to another user
- [ ] Cannot gift to self (validation works)
- [ ] Cannot gift more CC than owned
- [ ] Can gift Pokemon to another user
- [ ] Cannot gift Pokemon not owned
- [ ] Cannot gift last Pokemon
- [ ] Can gift Trainer to another user
- [ ] Cannot gift Trainer not owned
- [ ] Cannot gift last Trainer
- [ ] Name validation and sanitization works
- [ ] Amount validation works
- [ ] Both sender and receiver data updated correctly
- [ ] Data is saved after gift

### /pokedex Command
- [ ] Command shows up in Discord slash commands
- [ ] Can search Pokemon by name
- [ ] Can search Pokemon by ID
- [ ] Case-insensitive search works
- [ ] Shows Pokemon details correctly
- [ ] Toggle shiny button works
- [ ] Sprite URLs load correctly
- [ ] Close button works
- [ ] Invalid Pokemon shows proper error

### /showpokemon Command
- [ ] Command shows up in Discord slash commands
- [ ] Shows owned Pokemon by default
- [ ] Pagination works (prev/next buttons)
- [ ] Rarity filter works
- [ ] Ownership filter works (owned/unowned/all)
- [ ] Shiny filter works
- [ ] Shows correct counts
- [ ] Inspect button opens Pokemon details
- [ ] Toggle shiny works in inspect view
- [ ] Back button returns to list
- [ ] Close button works
- [ ] Collection stats are accurate

### /showtrainers Command
- [ ] Command shows up in Discord slash commands
- [ ] Shows owned trainers by default
- [ ] Pagination works
- [ ] Rarity filter works
- [ ] Ownership filter works
- [ ] Drill-down navigation works (class → variants → sprite)
- [ ] Back buttons work correctly
- [ ] Sprite images load correctly
- [ ] Collection stats are accurate

### /inspectpokemon Command
- [ ] Command shows up in Discord slash commands
- [ ] Can search Pokemon by name
- [ ] Can search Pokemon by ID
- [ ] Shows Pokemon details correctly
- [ ] Input validation works
- [ ] Name sanitization works
- [ ] Invalid names show proper error

### /inspecttrainer Command
- [ ] Command shows up in Discord slash commands
- [ ] Can view another user's trainers
- [ ] Rarity filter works
- [ ] Pagination works
- [ ] Shows correct ownership status
- [ ] Sprite links work correctly
- [ ] Shows proper message for users with no trainers

### /trainercard Command
- [ ] Command shows up in Discord slash commands
- [ ] Generates trainer card image successfully
- [ ] Shows correct TP, CC, and rank
- [ ] Avatar image loads correctly
- [ ] Pokemon sprites render correctly
- [ ] Trainer sprite renders correctly
- [ ] Navigation buttons work
- [ ] Can change displayed Pokemon
- [ ] Can change displayed Trainer
- [ ] Canvas rendering works without errors

### /adminsave Command
- [ ] Command shows up in Discord slash commands
- [ ] Only admins can use it
- [ ] Saves data to local file
- [ ] Saves backup to Discord channel
- [ ] Shows success message
- [ ] Handles errors gracefully

## Performance Testing

### Data Loading
- [ ] Pokemon data loads from cache (not file) on subsequent calls
- [ ] Trainer data loads from cache on subsequent calls
- [ ] Commands respond quickly (< 2 seconds)
- [ ] No duplicate file reads in logs

### Error Handling
- [ ] Bot recovers from Discord API errors
- [ ] Retry logic works for data loading
- [ ] Retry logic works for data saving
- [ ] User-friendly error messages appear
- [ ] Bot doesn't crash on command errors

### Memory Usage
- [ ] Memory usage is stable over time
- [ ] No memory leaks after repeated command use
- [ ] Cache doesn't grow unbounded

## Integration Testing

### Data Persistence
- [ ] Data persists after bot restart
- [ ] Local trainerData.json is created/updated
- [ ] Discord backup is created in storage channel
- [ ] Data can be restored from Discord backup
- [ ] Data can be restored from local file

### Rank System
- [ ] TP accumulates from messages
- [ ] Rank roles are assigned correctly
- [ ] Old rank roles are removed when promoted
- [ ] Rank calculation uses cached system
- [ ] getRank() returns correct rank for TP amount

### Validation System
- [ ] Invalid amounts are rejected
- [ ] Invalid user IDs are rejected
- [ ] Invalid Pokemon names are rejected
- [ ] Input sanitization prevents injection
- [ ] Cooldowns work correctly
- [ ] Resource checks prevent cheating

### UI Components
- [ ] Success embeds display correctly
- [ ] Error embeds display correctly
- [ ] Pokemon reward embeds show correct sprites
- [ ] Trainer reward embeds show correct sprites
- [ ] Pokedex embeds format correctly
- [ ] Collection stats embeds are accurate
- [ ] Buttons render and work correctly
- [ ] Select menus render and work correctly

## Stress Testing

### High Load
- [ ] Bot handles multiple simultaneous commands
- [ ] Commands don't interfere with each other
- [ ] Data doesn't corrupt under concurrent access
- [ ] Response times remain acceptable under load

### Edge Cases
- [ ] Empty collections display correctly
- [ ] Full collections display correctly
- [ ] Boundary values work (0 TP, max TP, etc.)
- [ ] Missing data fields are handled gracefully
- [ ] Malformed data is normalized

## Security Testing

### Input Validation
- [ ] Cannot inject code through Pokemon names
- [ ] Cannot inject code through Trainer names
- [ ] Cannot bypass cooldowns
- [ ] Cannot gift negative amounts
- [ ] Cannot exceed integer limits
- [ ] XSS attempts are sanitized

### Authorization
- [ ] Users can only modify their own data
- [ ] Users can't access admin commands
- [ ] Users can't gift from other users
- [ ] Users can't delete other users' data

## Monitoring

### Logging
- [ ] Successful commands are logged
- [ ] Errors are logged with stack traces
- [ ] Data saves are logged
- [ ] Retries are logged
- [ ] Performance issues are visible in logs

### Metrics
- [ ] Command usage can be tracked
- [ ] Error rates can be monitored
- [ ] Response times can be measured
- [ ] Cache hit rates can be observed

## Rollback Plan

### Pre-Deployment Backup
- [ ] Backup current trainerData.json
- [ ] Backup current bot code
- [ ] Document current environment variables
- [ ] Test restore procedure

### Rollback Procedure
- [ ] Know how to restore previous code version
- [ ] Know how to restore trainerData.json
- [ ] Know how to identify if rollback is needed
- [ ] Have emergency contact information

## Post-Deployment Monitoring

### First 24 Hours
- [ ] Monitor error rates
- [ ] Monitor response times
- [ ] Check data integrity
- [ ] Review user feedback
- [ ] Watch for memory leaks

### First Week
- [ ] Verify data backups are working
- [ ] Check cache performance
- [ ] Review all command usage
- [ ] Gather user feedback
- [ ] Optimize based on metrics

## Sign-Off

- [ ] All critical tests pass
- [ ] All blocking issues resolved
- [ ] Performance is acceptable
- [ ] Security review complete
- [ ] Documentation is up to date
- [ ] Team is trained on new code
- [ ] Rollback plan is ready
- [ ] Monitoring is configured

**Deployment Approved By:** _________________

**Date:** _________________

**Notes:**
