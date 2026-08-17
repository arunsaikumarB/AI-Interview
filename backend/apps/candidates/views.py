from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import StaffOnly
from apps.candidates.pagination import CandidatePagination
from apps.candidates.querysets import apply_candidate_filters, scoped_candidates
from apps.candidates.serializers import CandidateSerializer


class CandidateListView(ListAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]
    serializer_class = CandidateSerializer
    pagination_class = CandidatePagination

    def get_queryset(self):
        qs = scoped_candidates(self.request.user)
        params = self.request.query_params
        return apply_candidate_filters(
            qs,
            search=params.get("search") or params.get("q"),
            sort=params.get("sort") or params.get("ordering"),
        )


class CandidateDetailView(RetrieveAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]
    serializer_class = CandidateSerializer
    lookup_field = "id"
    lookup_url_kwarg = "id"

    def get_queryset(self):
        return scoped_candidates(self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response({"candidate": self.get_serializer(instance).data})
