from django.contrib import admin
from django.urls import path
from gameapp import views  
from django.contrib.auth import views as auth_views 
urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.home, name='home'),              # home page
    path('game/', views.game_page, name='game'),    # game page
    path('how-to-play/', views.how_to_play, name='how_to_play'),
    path('login/', auth_views.LoginView.as_view(template_name='accounts/login.html'), name='login'),
    path('register/', views.register, name='register'),
    path('logout/', auth_views.LogoutView.as_view(next_page='login'), name='logout'),
    path('save_score/', views.save_score, name='save_score')
]
