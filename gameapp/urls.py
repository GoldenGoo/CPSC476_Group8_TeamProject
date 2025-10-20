# gameapp/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('', views.home),
    path('home/', views.home),
    path('game/', views.game),
]