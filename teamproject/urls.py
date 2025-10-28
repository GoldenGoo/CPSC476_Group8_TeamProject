from django.contrib import admin
from django.urls import path, include
from django.shortcuts import redirect

from accounts import views as account_views  # import login/signup views if needed

# redirect root URL to login page
def root_redirect(request):
    return redirect('login')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('accounts/', include('accounts.urls')),  # login/signup/logout URLs
    path('', root_redirect),  # root URL redirects to login
    path('game/', include('gameapp.urls')),      # game page URLs
]
