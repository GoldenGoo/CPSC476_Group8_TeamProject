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
