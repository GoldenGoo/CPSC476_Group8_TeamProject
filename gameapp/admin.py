from django.contrib import admin
from .models import Score

@admin.register(Score)
class ScoreAdmin(admin.ModelAdmin):
    # This controls what columns show up in the list
    list_display = ('user', 'score', 'timestamp', 'game_mode')
    
    # This adds a sidebar to filter by date or game mode
    list_filter = ('timestamp', 'game_mode')
    
    # This adds a search bar to search by username
    search_fields = ('user__username',)