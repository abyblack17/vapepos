package com.polancotech.vapepos2;

import android.Manifest;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import java.net.URL;
import java.io.ByteArrayOutputStream;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name = "NativeBluetoothPrinter")
public class NativeBluetoothPrinterPlugin extends Plugin {
    private static final int PERMISSION_REQUEST_CODE = 7410;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private String[] requiredPermissions() {
        ArrayList<String> permissions = new ArrayList<>();
        permissions.add(Manifest.permission.CAMERA);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_SCAN);
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else {
            permissions.add(Manifest.permission.BLUETOOTH);
            permissions.add(Manifest.permission.BLUETOOTH_ADMIN);
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        return permissions.toArray(new String[0]);
    }

    private boolean hasAllPermissions() {
        for (String permission : requiredPermissions()) {
            if (ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void askPermissions() {
        ActivityCompat.requestPermissions(getActivity(), requiredPermissions(), PERMISSION_REQUEST_CODE);
    }

    @PluginMethod
    public void requestAppPermissions(PluginCall call) {
        if (!hasAllPermissions()) {
            askPermissions();
        }
        JSObject ret = new JSObject();
        ret.put("granted", hasAllPermissions());
        call.resolve(ret);
    }

    @PluginMethod
    public void selectPrinter(PluginCall call) {
        if (!hasAllPermissions()) {
            askPermissions();
            call.reject("Acepta los permisos de Bluetooth/Cámara y vuelve a presionar Agregar impresora.");
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Este dispositivo no tiene Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Activa el Bluetooth del teléfono e intenta de nuevo.");
            return;
        }

        Set<BluetoothDevice> bondedDevices = adapter.getBondedDevices();
        if (bondedDevices == null || bondedDevices.isEmpty()) {
            call.reject("No hay impresoras emparejadas. Empareja la impresora desde Ajustes de Android y vuelve a intentar.");
            return;
        }

        ArrayList<BluetoothDevice> devices = new ArrayList<>(bondedDevices);
        String[] labels = new String[devices.size()];
        for (int i = 0; i < devices.size(); i++) {
            BluetoothDevice device = devices.get(i);
            labels[i] = safeName(device) + "\n" + device.getAddress();
        }

        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Selecciona la impresora")
            .setItems(labels, (dialog, which) -> {
                BluetoothDevice selected = devices.get(which);
                JSObject ret = new JSObject();
                ret.put("name", safeName(selected));
                ret.put("address", selected.getAddress());
                call.resolve(ret);
            })
            .setNegativeButton("Cancelar", (dialog, which) -> call.reject("No seleccionaste ninguna impresora Bluetooth."))
            .show()
        );
    }

    @PluginMethod
    public void listPairedPrinters(PluginCall call) {
        if (!hasAllPermissions()) {
            askPermissions();
            call.reject("Acepta los permisos de Bluetooth y vuelve a intentar.");
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        JSArray array = new JSArray();
        if (adapter != null && adapter.isEnabled()) {
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            if (devices != null) {
                for (BluetoothDevice device : devices) {
                    JSObject item = new JSObject();
                    item.put("name", safeName(device));
                    item.put("address", device.getAddress());
                    array.put(item);
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", array);
        call.resolve(ret);
    }

    @PluginMethod
    public void printText(PluginCall call) {
        if (!hasAllPermissions()) {
            askPermissions();
            call.reject("Acepta los permisos de Bluetooth y vuelve a imprimir.");
            return;
        }

        String address = call.getString("address", "");
        String text = call.getString("text", "");
        int copies = Math.max(1, call.getInt("copies", 1));
        String name = call.getString("name", "Impresora Bluetooth");
        String paperSize = call.getString("paperSize", "58mm");
        String logoUrl = call.getString("logoUrl", "");

        if (address == null || address.trim().isEmpty()) {
            call.reject("No hay impresora guardada. Agrega una impresora en Configuración.");
            return;
        }
        if (text == null || text.trim().isEmpty()) {
            call.reject("No hay contenido para imprimir.");
            return;
        }

        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) throw new Exception("Este dispositivo no tiene Bluetooth.");
                if (!adapter.isEnabled()) throw new Exception("Activa el Bluetooth del teléfono.");

                BluetoothDevice device = adapter.getRemoteDevice(address);
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                adapter.cancelDiscovery();
                socket.connect();

                OutputStream output = socket.getOutputStream();
                byte[] payload = buildEscPosPayload(text, copies, paperSize, logoUrl);
                output.write(payload);
                output.flush();
                Thread.sleep(250);

                JSObject ret = new JSObject();
                ret.put("name", name);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("No se pudo imprimir por Bluetooth: " + e.getMessage());
            } finally {
                try {
                    if (socket != null) socket.close();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    private byte[] buildEscPosPayload(String text, int copies, String paperSize, String logoUrl) throws Exception {
        ArrayList<Byte> bytes = new ArrayList<>();
        Charset charset;
        try {
            charset = Charset.forName("CP437");
        } catch (Exception e) {
            charset = Charset.forName("ISO-8859-1");
        }

        for (int c = 0; c < copies; c++) {
            add(bytes, new byte[]{0x1B, 0x40}); // init
            add(bytes, new byte[]{0x1B, 0x74, 0x10}); // code page WPC1252 / latin when supported
            add(bytes, new byte[]{0x1B, 0x21, 0x00}); // normal size, readable receipt text
            add(bytes, new byte[]{0x1B, 0x4D, 0x00}); // font A: larger and clearer than font B
            add(bytes, new byte[]{0x1D, 0x21, 0x00}); // normal width/height

            byte[] logo = buildLogoPayload(logoUrl, paperSize);
            if (logo != null && logo.length > 0) {
                add(bytes, new byte[]{0x1B, 0x61, 0x01}); // center
                add(bytes, logo);
                add(bytes, new byte[]{0x0A});
            }

            add(bytes, new byte[]{0x1B, 0x61, 0x00}); // left align; text already contains centered lines
            add(bytes, new byte[]{0x1B, 0x21, 0x00}); // keep readable font for body
            add(bytes, text.getBytes(charset));
            add(bytes, new byte[]{0x0A, 0x0A, 0x0A});
            add(bytes, new byte[]{0x1D, 0x56, 0x42, 0x00}); // cut if supported
        }

        byte[] out = new byte[bytes.size()];
        for (int i = 0; i < bytes.size(); i++) out[i] = bytes.get(i);
        return out;
    }


    private byte[] buildLogoPayload(String logoUrl, String paperSize) {
        if (logoUrl == null || logoUrl.trim().isEmpty()) return null;
        try {
            Bitmap source;
            if (logoUrl.startsWith("data:image")) {
                String base64 = logoUrl.substring(logoUrl.indexOf(',') + 1);
                byte[] decoded = Base64.decode(base64, Base64.DEFAULT);
                source = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
            } else {
                source = BitmapFactory.decodeStream(new URL(logoUrl).openStream());
            }
            if (source == null) return null;

            int maxWidth = 280;
            if ("48mm".equals(paperSize)) maxWidth = 220;
            if ("80mm".equals(paperSize)) maxWidth = 360;
            int width = Math.min(maxWidth, source.getWidth());
            int height = Math.max(1, (int) ((float) source.getHeight() * width / source.getWidth()));
            Bitmap bitmap = Bitmap.createScaledBitmap(source, width, height, true);

            int bytesPerRow = (bitmap.getWidth() + 7) / 8;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            out.write(new byte[]{0x1D, 0x76, 0x30, 0x00});
            out.write(bytesPerRow & 0xFF);
            out.write((bytesPerRow >> 8) & 0xFF);
            out.write(bitmap.getHeight() & 0xFF);
            out.write((bitmap.getHeight() >> 8) & 0xFF);

            for (int y = 0; y < bitmap.getHeight(); y++) {
                for (int xByte = 0; xByte < bytesPerRow; xByte++) {
                    int value = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = xByte * 8 + bit;
                        if (x < bitmap.getWidth()) {
                            int pixel = bitmap.getPixel(x, y);
                            int r = (pixel >> 16) & 0xff;
                            int g = (pixel >> 8) & 0xff;
                            int b = pixel & 0xff;
                            int alpha = (pixel >> 24) & 0xff;
                            int luminance = (r * 299 + g * 587 + b * 114) / 1000;
                            if (alpha > 60 && luminance < 170) value |= (0x80 >> bit);
                        }
                    }
                    out.write(value);
                }
            }
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private void add(ArrayList<Byte> target, byte[] values) {
        for (byte value : values) target.add(value);
    }

    private String safeName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? "Impresora Bluetooth" : name;
        } catch (SecurityException e) {
            return "Impresora Bluetooth";
        }
    }
}
