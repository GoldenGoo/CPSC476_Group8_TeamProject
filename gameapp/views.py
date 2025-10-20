from django.shortcuts import render

# Create your views here.
# Show home-screen
def home(request):
    return render(request, "home.html")

# Show game-screen
def game(request):
    return render(request, "game.html")
