import json
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from .models import Score
from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib import messages


@login_required
def home(request):
    return render(request, "home.html")

@login_required
def game_page(request):
    return render(request, "game.html")

@login_required
def how_to_play(request):
    return render(request, "how_to_play.html")

@login_required
def scores_page(request):
    # Get all scores ordered by timestamp (newest first)
    all_scores = Score.objects.all().order_by('-timestamp')
    
    # Get scores for current user
    user_scores = Score.objects.filter(user=request.user).order_by('-timestamp')
    
    # Get top scores across all players
    top_scores = Score.objects.all().order_by('-score')[:10]
    
    # Get scores grouped by user
    from django.db.models import Count, Avg, Max
    user_stats = Score.objects.values('user__username').annotate(
        total_games=Count('id'),
        avg_score=Avg('score'),
        best_score=Max('score')
    ).order_by('-best_score')
    
    context = {
        'all_scores': all_scores,
        'user_scores': user_scores,
        'top_scores': top_scores,
        'user_stats': user_stats,
    }
    return render(request, "scores.html", context)


def register(request):
    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")
        password2 = request.POST.get("password2")

        # Check if passwords match
        if password != password2:
            messages.error(request, "Passwords do not match")
        # Check if username already exists
        elif User.objects.filter(username=username).exists():
            messages.error(request, "Username already taken")
        else:
            # Create user
            User.objects.create_user(username=username, password=password)
            messages.success(request, "Account created successfully!")
            return redirect("login")  # redirect to your login page

    return render(request, "accounts/register.html")

@login_required
@require_POST
def save_score(request):
    try:
        data = json.loads(request.body)
        score_value = data.get('score')
        game_mode_value = data.get('game_mode', 'Unknown Player')
        player_name_value = data.get('player_name', 'Unknown Player')
        
        # Create the score record
        Score.objects.create(
            user=request.user,
            score=score_value,
            game_mode=game_mode_value,
            player_name=player_name_value
        )
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)