package com.eboses.app;

import android.content.MutableContextWrapper;
import android.os.CancellationSignal;

import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SavedCredentials")
public class SavedCredentialsPlugin extends Plugin {
    private CredentialManager manager() {
        return CredentialManager.create(getActivity());
    }

    @PluginMethod
    public void savePassword(PluginCall call) {
        String id = call.getString("id");
        String password = call.getString("password");
        if (id == null || id.trim().isEmpty() || password == null || password.isEmpty()) {
            call.reject("A username and password are required.");
            return;
        }

        CreatePasswordRequest request = new CreatePasswordRequest(id, password);
        manager().createCredentialAsync(
            new MutableContextWrapper(getActivity()),
            request,
            new CancellationSignal(),
            getActivity().getMainExecutor(),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse result) {
                    call.resolve();
                }

                @Override
                public void onError(CreateCredentialException error) {
                    call.reject(error.getMessage(), error);
                }
            }
        );
    }

    @PluginMethod
    public void getPassword(PluginCall call) {
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetPasswordOption())
            .build();

        manager().getCredentialAsync(
            new MutableContextWrapper(getActivity()),
            request,
            new CancellationSignal(),
            getActivity().getMainExecutor(),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential credential = result.getCredential();
                    if (!(credential instanceof PasswordCredential)) {
                        call.reject("The selected credential is not a password.");
                        return;
                    }
                    PasswordCredential password = (PasswordCredential) credential;
                    JSObject response = new JSObject();
                    response.put("id", password.getId());
                    response.put("password", password.getPassword());
                    call.resolve(response);
                }

                @Override
                public void onError(GetCredentialException error) {
                    call.reject(error.getMessage(), error);
                }
            }
        );
    }
}
