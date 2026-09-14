from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from . import models as m


@admin.register(m.User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "name", "email", "is_active")
    fieldsets = BaseUserAdmin.fieldsets + (("Tracker", {"fields": ("name", "roles")}),)
    filter_horizontal = ("roles", "groups", "user_permissions")


for model in (m.Role, m.RolePermission, m.Threshold, m.Project, m.ProjectMembership, m.ChronologyEvent, m.Document, m.Attachment,
              m.Approval, m.Vendor, m.InventoryItem, m.StockLocation, m.CostItem, m.PurchaseOrder, m.PurchaseItem, m.GoodsReceipt,
              m.Asset, m.StockMovement, m.Actual, m.ChangeOrder, m.Retention, m.QbBill, m.SiteVisit, m.Issue, m.CommissioningRecord,
              m.HseIncident, m.WarrantyClaim, m.StockCount):
    admin.site.register(model)
