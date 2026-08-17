from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication


class MeView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "external_user_id": user.id,
                "email": user.email,
                "role": user.role.value,
                "organization_id": user.organization_id,
            }
        )
