from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class ApplicationPagination(PageNumberPagination):
    page_size = 25
    page_query_param = "page"
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.page.paginator.count,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "applications": data,
            }
        )
