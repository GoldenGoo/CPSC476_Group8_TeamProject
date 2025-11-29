# Score Logging System - Complete Setup ✅

## What's Configured

### 1. Database Model ✅

**File:** `gameapp/models.py`

```python
class Score(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    score = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)
    game_mode = models.CharField(max_length=50, default="standard")
```

### 2. Backend API Endpoint ✅

**File:** `gameapp/views.py`

- Function: `save_score(request)`
- Route: `/save_score/`
- Authentication: `@login_required` - Only authenticated users can save scores
- Automatically associates score with logged-in user

### 3. URL Configuration ✅

**File:** `gameapp/urls.py`

- Added: `path('save_score/', views.save_score, name='save_score')`

### 4. Admin Panel ✅

**File:** `gameapp/admin.py`

- Display: Username, Score, Timestamp, Game Mode
- Filter: By date and game mode
- Search: By username

### 5. Frontend Integration ✅

**File:** `gameapp/static/js/game.js`

- When game ends, `_sendScoreToBackend(score)` is called
- Only human players (Player 1 & Player 2) are saved
- AI scores are NOT logged (as intended)
- Sends: score value + game_mode (player identifier)
- Uses CSRF token for security

### 6. Database Migrations ✅

**Status:** COMPLETE

- Ran: `python manage.py makemigrations`
- Ran: `python manage.py migrate`
- Table: `gameapp_score` created successfully

## How It Works

### When a Player Loses:

1. Player's game ends (piece goes out of bounds)
2. `_onOutOfBounds()` function triggers
3. `_sendScoreToBackend(this.score)` is called
4. POST request sent to `/save_score/` with:
   - Score value (integer)
   - Game mode (Player 1 or Player 2)
   - CSRF token (for security)
5. Django backend receives request
6. Score saved to database with:
   - Logged-in user (from `request.user`)
   - Score value
   - Timestamp (auto-generated)
   - Game mode
7. Success response returned to frontend

## Viewing Scores

### Admin Panel

1. Go to: `http://localhost:8000/admin/`
2. Login with superuser credentials
3. Click "Scores" under GAMEAPP section
4. Features:
   - View all scores with user, score, date, game mode
   - Filter by date or game mode
   - Search by username
   - Sort by any column

## Database Fields

| Column    | Type        | Notes                           |
| --------- | ----------- | ------------------------------- |
| id        | Integer     | Primary key (auto)              |
| user      | Foreign Key | Links to Django User            |
| score     | Integer     | Final game score                |
| timestamp | DateTime    | When score was achieved         |
| game_mode | String      | "Player 1", "Player 2", or "AI" |

## Testing

To test the system:

1. Open browser to `http://localhost:8000/game/`
2. Login as a user
3. Play a game
4. Let the game end (go out of bounds)
5. Check Django admin to see the score logged

## Notes

✅ Scores are ONLY saved for human players (Player 1 & Player 2)
✅ AI player scores are NOT saved to database
✅ Each score is tied to the logged-in user
✅ Timestamps are automatic
✅ All requests are secure (CSRF protected, login required)
✅ Database table created and ready

## Troubleshooting

If you get "no such table" error:

```bash
python manage.py makemigrations
python manage.py migrate
```

If scores not showing in admin:

1. Make sure you're logged in as superuser
2. Check browser console for errors (F12)
3. Check Django server console for errors
4. Verify user is authenticated when playing

---

**Status:** ✅ Ready to use - Start playing and your scores will be automatically saved!
