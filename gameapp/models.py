from django.db import models
from django.contrib.auth.models import User

class Score(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    score = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)
    # Tracks if it was Player 1 or Player 2 
    game_mode = models.CharField(max_length=50, default="standard")
    # Custom player name as entered before game
    player_name = models.CharField(max_length=50, default="Unknown Player")

    def __str__(self):
        return f"{self.player_name} ({self.user.username}) - {self.score}"