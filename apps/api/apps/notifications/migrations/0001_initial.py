# Generated manually for E-Boses notification workflows.
import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL), ('emergencies', '0001_initial')]
    operations = [
        migrations.CreateModel(name='Notification', fields=[('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ('type', models.CharField(choices=[('resident_update', 'Resident Update'), ('responder_alert', 'Responder Alert'), ('barangay_staff', 'Barangay Staff'), ('witness_alert', 'Witness Alert')], max_length=40)), ('title', models.CharField(max_length=120)), ('body', models.TextField()), ('data', models.JSONField(blank=True, default=dict)), ('read_at', models.DateTimeField(blank=True, null=True)), ('created_at', models.DateTimeField(auto_now_add=True)), ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to=settings.AUTH_USER_MODEL))], options={'ordering': ['-created_at']}),
        migrations.CreateModel(name='DeviceToken', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('token', models.CharField(max_length=255, unique=True)), ('platform', models.CharField(blank=True, max_length=30)), ('created_at', models.DateTimeField(auto_now_add=True)), ('last_seen_at', models.DateTimeField(auto_now=True)), ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='device_tokens', to=settings.AUTH_USER_MODEL))]),
        migrations.CreateModel(name='WitnessNotification', fields=[('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ('sent_at', models.DateTimeField(auto_now_add=True)), ('delivery_status', models.CharField(choices=[('delivered', 'Delivered'), ('failed', 'Failed'), ('pending', 'Pending')], default='delivered', max_length=20)), ('alert', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='witness_notifications', to='emergencies.emergencyalert')), ('resident', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='witness_notifications', to=settings.AUTH_USER_MODEL))], options={'unique_together': {('alert', 'resident')}}),
        migrations.AddIndex(model_name='notification', index=models.Index(fields=['recipient', 'read_at'], name='notificatio_recipie_b33727_idx')),
        migrations.AddIndex(model_name='notification', index=models.Index(fields=['type', 'created_at'], name='notificatio_type_4ac58d_idx')),
    ]
